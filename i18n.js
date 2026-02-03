// i18n.js - Internationalization support for QCut website
const translations = { en, zh, ja };

const LANGUAGES = {
    en: { name: 'EN', flag: '🇺🇸' },
    zh: { name: '中文', flag: '🇨🇳' },
    ja: { name: '日本語', flag: '🇯🇵' }
};

let currentLang = 'en';

// Get saved language or detect from browser
function getInitialLanguage() {
    const saved = localStorage.getItem('lang');
    if (saved && translations[saved]) return saved;
    
    // Detect from browser
    const browserLang = navigator.language.slice(0, 2);
    if (browserLang === 'zh') return 'zh';
    if (browserLang === 'ja') return 'ja';
    return 'en';
}

// Apply translations to all elements with data-i18n
function applyTranslations(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    
    const t = translations[lang];
    if (!t) return;
    
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = t[key];
            } else {
                el.innerHTML = t[key];
            }
        }
    });
    
    // Update page title
    document.title = `QCut - ${lang === 'zh' ? 'AI 视频编辑器' : lang === 'ja' ? 'AIビデオエディター' : 'The AI Video Editor'}`;
    
    // Update language selector display
    updateLanguageSelector();
}

// Update language selector UI
function updateLanguageSelector() {
    const btn = document.getElementById('lang-btn');
    if (btn) {
        btn.innerHTML = `
            <span class="text-sm">${LANGUAGES[currentLang].flag}</span>
            <span class="text-sm">${LANGUAGES[currentLang].name}</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        `;
    }
}

// Switch language
function switchLanguage(lang) {
    if (translations[lang]) {
        applyTranslations(lang);
        closeLangMenu();
    }
}

// Toggle language menu
function toggleLangMenu() {
    const menu = document.getElementById('lang-menu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

function closeLangMenu() {
    const menu = document.getElementById('lang-menu');
    if (menu) {
        menu.classList.add('hidden');
    }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const langSelector = document.getElementById('lang-selector');
    if (langSelector && !langSelector.contains(e.target)) {
        closeLangMenu();
    }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const initialLang = getInitialLanguage();
    applyTranslations(initialLang);
});
