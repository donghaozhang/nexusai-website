# Custom Components Documentation

This document describes the custom classes and interactive components used across the NexusAI website.

## CSS Utility Classes

- **`orbitron`** – Applies the Orbitron font for futuristic headings.
- **`gradient-text`** – Renders text with a blue‑purple‑pink gradient.
- **`glow`** – Adds a subtle glow effect via `text-shadow`.
- **`card-glow`** – Provides a box‑shadow highlight for cards.
- **`hero-gradient`** – Background gradient used on the hero section.
- **`pulse-animation`** – Reusable pulsing animation for call‑to‑action buttons.
- **`grid-pattern`** – Draws a faint grid background across the page.
- **`terminal`**, **`terminal-header`**, **`terminal-body`** – Styles for the terminal demo component.
- **`blink`** – Keyframe animation creating a blinking cursor effect.
- **`fade-in`** – Initial style for elements animated when scrolled into view.
- **`animate-fadeIn`** – Applied by JavaScript when elements become visible.
- **`skip-link`** – Hidden link that becomes visible on focus to let keyboard users jump directly to the main content.

## JavaScript Components

Scripts inside `index.html` enhance the site with:

- Theme toggling between light and dark modes.
- Language selection and dynamic text replacement.
- Mobile menu open/close functionality.
- Smooth scrolling for in‑page navigation links.
- Intersection Observer that adds `animate-fadeIn` to `.fade-in` elements.
- Terminal typing effect simulating agent commands.
- Cookie consent banner with persistent acceptance.
- Contact form validation before submission.

These components are implemented inline in the main page and require no external dependencies aside from Tailwind CSS and Font Awesome.
