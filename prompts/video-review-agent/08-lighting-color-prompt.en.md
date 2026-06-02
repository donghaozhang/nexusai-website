# Lighting/Color Prompt

Category: lighting/color
Goal: Judge brightness, color, exposure, skin tone, and shot-to-shot visual consistency.

Check underexposure, overexposure, unstable exposure, unnatural skin tone, color mismatch between shots, or color choices that weaken the emotion. Give specific correction directions such as brighten, darken, unify color temperature, reduce saturation, or regrade.

Return ONLY a JSON array with timestamp, category, severity, comment, and fix. If no issues are found, return [].

