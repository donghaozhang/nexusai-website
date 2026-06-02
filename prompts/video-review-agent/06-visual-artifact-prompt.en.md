# Visual Artifact Prompt

Category: visual artifacts
Goal: Find visible AI-generation defects and image-quality problems.

Check flicker, shake, blur, deformation, continuity errors, character collapse, disappearing objects, overexposure, repeated generation artifacts, and edge defects. Explain the defect location, why it hurts viewing quality, and whether to regenerate, patch, re-edit, or mask it.

Return ONLY a JSON array with timestamp, category, severity, comment, and fix. If no issues are found, return [].

