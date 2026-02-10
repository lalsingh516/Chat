// crypto.js - Handles Client-Side Encryption

export async function generateKey(passphrase) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    // Static salt for simplicity in this project (in prod, store unique salts)
    const salt = enc.encode("SECURE_CHAT_SALT_STATIC_V1");

    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function encryptMessage(text, key) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(text);

    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoded
    );

    // Return as string: [IV_ARRAY]|[CIPHER_ARRAY]
    return JSON.stringify(Array.from(iv)) + "|" + JSON.stringify(Array.from(new Uint8Array(ciphertext)));
}

export async function decryptMessage(packagedData, key) {
    try {
        const parts = packagedData.split("|");
        if(parts.length !== 2) return "[Invalid Encrypted Data]";

        const iv = new Uint8Array(JSON.parse(parts[0]));
        const ciphertext = new Uint8Array(JSON.parse(parts[1]));

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );

        const dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (e) {
        console.error("Decrypt fail", e);
        return "🔒 Decryption Failed (Wrong Secret?)";
    }
}