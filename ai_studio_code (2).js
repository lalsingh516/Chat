import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, get, child, update, onDisconnect, serverTimestamp, query, limitToLast } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { generateKey, encryptMessage, decryptMessage } from './crypto.js';

// --- CONFIGURATION ---
const firebaseConfig = {
  // PASTE YOUR FIREBASE CONFIG HERE
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- STATE ---
let currentUser = null;
let currentChatId = null;
let currentChatKey = null;
let chatListenerUnsub = null; // Unsub function

// --- VIEWS & UTILS ---
const views = {
    auth: document.getElementById('auth-view'),
    setup: document.getElementById('profile-setup-view'),
    list: document.getElementById('chat-list-view'),
    room: document.getElementById('chat-room-view')
};

function showView(name) {
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[name].classList.add('active');
}

// Helper: Compress Image to Base64
const compressImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600; 
            const scale = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
    };
    reader.onerror = reject;
});

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Check profile
        const snap = await get(ref(db, `users/${user.uid}`));
        if (snap.exists()) {
            setupPresence();
            setupProfileNav();
            loadChats();
            showView('list');
        } else {
            showView('setup');
        }
    } else {
        currentUser = null;
        showView('auth');
    }
});

function setupPresence() {
    const connectedRef = ref(db, ".info/connected");
    const userStatusRef = ref(db, `users/${currentUser.uid}`);
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            onDisconnect(userStatusRef).update({ isOnline: false, lastSeen: serverTimestamp() });
            update(userStatusRef, { isOnline: true, lastSeen: serverTimestamp() });
        }
    });
}

// Login / Signup Handlers
document.getElementById('btn-login').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, e, p).catch(err => alert(err.message));
};

document.getElementById('btn-signup').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    createUserWithEmailAndPassword(auth, e, p).catch(err => alert(err.message));
};

document.getElementById('btn-logout').onclick = () => {
    const userStatusRef = ref(db, `users/${currentUser.uid}`);
    update(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() })
        .then(() => signOut(auth));
};

// --- PROFILE SETUP (Uses Base64) ---
document.getElementById('setup-avatar-input').onchange = async (e) => {
    if(e.target.files[0]) {
        const base64 = await compressImage(e.target.files[0]);
        document.getElementById('setup-avatar-preview').src = base64;
    }
};

document.getElementById('btn-save-profile').onclick = async () => {
    const name = document.getElementById('setup-name').value;
    const bio = document.getElementById('setup-bio').value;
    const src = document.getElementById('setup-avatar-preview').src;
    
    if(!name) return alert("Name required");
    
    await update(ref(db, `users/${currentUser.uid}`), {
        displayName: name,
        bio: bio,
        email: currentUser.email,
        photoURL: src, // Base64 string
        uid: currentUser.uid
    });
    
    setupPresence();
    setupProfileNav();
    loadChats();
    showView('list');
};

function setupProfileNav() {
    get(ref(db, `users/${currentUser.uid}`)).then(snap => {
        const d = snap.val();
        document.getElementById('nav-avatar').src = d.photoURL;
        document.getElementById('my-profile-trigger').onclick = () => {
            document.getElementById('setup-name').value = d.displayName;
            document.getElementById('setup-bio').value = d.bio;
            document.getElementById('setup-avatar-preview').src = d.photoURL;
            showView('setup');
        };
    });
}

// --- CHAT LIST LOGIC ---
document.getElementById('btn-new-chat').onclick = async () => {
    const email = prompt("Enter user email:");
    if(!email) return;
    
    // Simple user search (Inefficient, but fine for small user base)
    const snap = await get(ref(db, 'users'));
    let otherUser = null;
    snap.forEach(c => { if(c.val().email === email) otherUser = c.val(); });
    
    if(!otherUser) return alert("User not found");
    
    const newChatRef = push(ref(db, 'chats'));
    const cid = newChatRef.key;
    
    const updates = {};
    updates[`/chats/${cid}`] = {
        metadata: {
            participants: { [currentUser.uid]: true, [otherUser.uid]: true },
            updatedAt: serverTimestamp(),
            lastMessage: "New Chat"
        }
    };
    updates[`/user-chats/${currentUser.uid}/${cid}`] = true;
    updates[`/user-chats/${otherUser.uid}/${cid}`] = true;
    
    await update(ref(db), updates);
};

function loadChats() {
    const myChatsRef = ref(db, `user-chats/${currentUser.uid}`);
    onValue(myChatsRef, (snap) => {
        const container = document.getElementById('chats-container');
        container.innerHTML = "";
        
        snap.forEach(c => {
            const chatId = c.key;
            // Listen to metadata
            onValue(ref(db, `chats/${chatId}/metadata`), async (metaSnap) => {
                const meta = metaSnap.val();
                if(!meta) return;
                
                const otherUid = Object.keys(meta.participants).find(id => id !== currentUser.uid);
                const uSnap = await get(ref(db, `users/${otherUid}`));
                const uData = uSnap.val();
                
                // Build UI
                // Check if element exists to avoid flickering, otherwise create
                let el = document.getElementById(`chat-item-${chatId}`);
                if(!el) {
                    el = document.createElement('div');
                    el.id = `chat-item-${chatId}`;
                    el.className = 'chat-item';
                    el.onclick = () => promptSecret(chatId, uData);
                    container.appendChild(el);
                }
                
                el.innerHTML = `
                    <img src="${uData.photoURL}">
                    <div class="chat-details">
                        <h4>${uData.displayName}</h4>
                        <p>${meta.lastMessage}</p>
                    </div>
                `;
            });
        });
    });
}

// --- CHAT ROOM LOGIC ---
function promptSecret(chatId, otherUser) {
    const modal = document.getElementById('secret-key-modal');
    modal.style.display = 'flex';
    document.getElementById('chat-secret-input').value = "";
    
    document.getElementById('btn-confirm-secret').onclick = async () => {
        const s = document.getElementById('chat-secret-input').value;
        if(!s) return;
        try {
            currentChatKey = await generateKey(s);
            modal.style.display = 'none';
            openChat(chatId, otherUser);
        } catch(e) { alert("Key Error"); }
    };
}

function openChat(chatId, otherUser) {
    currentChatId = chatId;
    showView('room');
    
    // Header
    const nameEl = document.getElementById('chat-name');
    const statusEl = document.getElementById('chat-status');
    const avatarEl = document.getElementById('chat-avatar');
    
    nameEl.innerText = otherUser.displayName;
    avatarEl.src = otherUser.photoURL;
    
    // Header click for profile
    document.getElementById('chat-header-info').onclick = () => {
        const m = document.getElementById('user-profile-modal');
        document.getElementById('modal-avatar').src = otherUser.photoURL;
        document.getElementById('modal-name').innerText = otherUser.displayName;
        document.getElementById('modal-email').innerText = otherUser.email;
        document.getElementById('modal-bio').innerText = otherUser.bio;
        m.style.display = 'flex';
        document.querySelector('.close-modal').onclick = () => m.style.display = 'none';
    };
    
    // Realtime Presence for this user
    onValue(ref(db, `users/${otherUser.uid}`), (s) => {
        const d = s.val();
        if(d.isOnline) {
            statusEl.innerText = "Online";
            statusEl.style.color = "#25D366";
        } else {
            statusEl.innerText = "Offline";
            statusEl.style.color = "#ccc";
        }
    });
    
    // Load Messages
    const msgsRef = query(ref(db, `chats/${chatId}/messages`), limitToLast(50));
    // Clear old listener
    if(chatListenerUnsub) chatListenerUnsub(); 
    
    // RTDB onValue returns the unsub function
    chatListenerUnsub = onValue(msgsRef, (snap) => {
        const container = document.getElementById('messages-container');
        container.innerHTML = "";
        
        snap.forEach(c => {
            const data = c.val();
            // Decrypt
            decryptMessage(data.encryptedContent, currentChatKey).then(txt => {
                renderMsg(data, txt);
            });
        });
        setTimeout(() => container.scrollTop = container.scrollHeight, 100);
    });
}

function renderMsg(data, content) {
    const container = document.getElementById('messages-container');
    const isMe = data.senderId === currentUser.uid;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'outgoing' : 'incoming'}`;
    
    let body = "";
    if(data.type === 'image') {
        body = `<img src="${content}" onclick="window.open(this.src)">`;
    } else {
        // Escape HTML for text
        const safeText = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        body = `<span>${safeText}</span>`;
    }
    
    const time = new Date(data.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    div.innerHTML = `${body}<div class="meta">${time} ${isMe ? '<i class="fas fa-check"></i>' : ''}</div>`;
    container.appendChild(div);
}

// --- SENDING MESSAGES ---
document.getElementById('btn-back').onclick = () => {
    currentChatId = null;
    currentChatKey = null;
    showView('list');
};

document.getElementById('btn-send').onclick = () => sendPayload('text');

// Handle Image Select
document.getElementById('media-input').onchange = async (e) => {
    if(e.target.files[0]) {
        // UI Loading
        const btn = document.getElementById('btn-send');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const base64 = await compressImage(e.target.files[0]);
            await sendPayload('image', base64);
        } catch(err) {
            console.error(err);
        }
        
        btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        e.target.value = ''; // reset
    }
};

async function sendPayload(type, content = null) {
    const input = document.getElementById('message-input');
    const raw = type === 'text' ? input.value : content;
    
    if(type === 'text' && !raw.trim()) return;
    
    const enc = await encryptMessage(raw, currentChatKey);
    
    await push(ref(db, `chats/${currentChatId}/messages`), {
        encryptedContent: enc,
        senderId: currentUser.uid,
        timestamp: serverTimestamp(),
        type: type
    });
    
    await update(ref(db, `chats/${currentChatId}/metadata`), {
        lastMessage: type === 'text' ? "🔒 Message" : "📷 Photo",
        updatedAt: serverTimestamp()
    });
    
    input.value = "";
}