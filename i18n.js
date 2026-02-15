// i18n.js - Internationalization support for QCut website
const translations = { en, zh, ja };

const LANGUAGES = {
    en: { name: 'EN' },
    zh: { name: '中文' },
    ja: { name: '日本語' }
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
    const label = document.getElementById('lang-label');
    if (label) {
        label.textContent = LANGUAGES[currentLang].name;
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
