// BNEWS Utility Functions (Date formatting, slugs, etc.)

/**
 * Formats Firestore Timestamp to a readable string.
 * @param {Date | object} timestamp - Firestore timestamp object or Date object.
 * @returns {string} Formatted date string (e.g., "Jan 15, 2024 at 10:30 AM").
 */
export function formatDate(timestamp) {
    if (!timestamp) return "N/A";
    let date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else {
        date = new Date(timestamp);
    }
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return date.toLocaleDateString('en-US', options);
}

/**
 * Calculates estimated reading time.
 * @param {string} text - The body of the article.
 * @returns {number} Reading time in minutes.
 */
export function calculateReadingTime(text) {
    const wpm = 225; // Average reading speed words per minute
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words / wpm);
}

/**
 * Creates a URL-friendly slug.
 * @param {string} text - The input string (usually the title).
 * @returns {string} The slugified string.
 */
export function createSlug(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces and dashes
        .replace(/[\s_-]+/g, '-') // Replace spaces and repeated dashes with a single dash
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
}

/**
 * Gets the first sentence for meta description purposes.
 * @param {string} text - The body text.
 * @returns {string} The truncated description.
 */
export function generateMetaDescription(text) {
    if (!text) return "Latest breaking news and updates from BNEWS.";
    const cleanedText = text.replace(/<[^>]*>?/gm, ''); // Remove HTML tags
    return cleanedText.substring(0, 150) + (cleanedText.length > 150 ? '...' : '');
}