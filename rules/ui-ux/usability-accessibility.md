---
title: "Usability and Accessibility in UI/UX Design"
rule_id: "RULE-UX-005"
category: "correctness"
scope: "all"
applies_to: "UI/UX Design"
last_updated: "2026-10-01"
source: "https://www.nngroup.com/articles/usability-101-introduction-to-usability/, https://www.nngroup.com/articles/accessibility/, https://www.nngroup.com/articles/inclusive-design/"
---

# Usability and Accessibility in UI/UX Design
Usability focuses on how easy and efficient it is for users to achieve their goals with a product. Accessibility ensures that people with disabilities can perceive, understand, navigate, and interact with the web and digital tools. Together, they create inclusive experiences that work for the widest possible audience.

## Why
Neglecting usability and accessibility leads to:
- **Excluded users**: People with disabilities or situational limitations cannot use the product
- **Poor user experience**: Even users without disabilities struggle with confusing or inefficient interfaces
- **Legal risks**: Non-compliance with accessibility laws (ADA, Section 508, EN 301 549, etc.)
- **Missed market opportunities**: Overlooking the significant purchasing power of people with disabilities
- **Damaged reputation**: Perception of being uncaring or discriminatory toward users with different abilities
- **Increased support costs**: Users need help accomplishing basic tasks due to poor design

Without good usability and accessibility:
- Users abandon tasks due to frustration or confusion
- Critical information is missed by users with visual, auditory, or cognitive impairments
- Keyboard-only or screen reader users cannot navigate or operate the interface
- Touch targets are too small or close together for accurate interaction
- Content is not perceivable in different lighting conditions or with assistive technologies
- Error prevention and recovery mechanisms are inadequate for all users

## Do
- **Follow core usability principles**:
  - **Learnability**: How easy is it for users to accomplish basic tasks the first time?
  - **Efficiency**: Once learned, how quickly can users perform tasks?
  - **Memorability**: When users return after a period, how easily can they reestablish proficiency?
  - **Errors**: How many errors do users make, how severe are they, and how easily can they recover?
  - **Satisfaction**: How pleasant is it to use the design?

- **Implement usability best practices**:
  - Conduct usability testing with 5 users per segment early and often
  - Use clear and concise language in labels, instructions, and error messages
  - Provide predictable navigation and consistent interaction patterns
  - Design for forgiveness—make it easy to recover from errors
  - Minimize cognitive load by chunking information and using recognition over recall
  - Provide feedback for all user actions and system status
  - Optimize task flows to reduce unnecessary steps

- **Follow accessibility guidelines (WCAG 2.2)**:
  - **Perceivable**: Provide text alternatives for non-text content, create content that can be presented in different ways, make it easier for users to see and hear content
  - **Operable**: Make all functionality available from a keyboard, give users enough time to read and use content, do not use content that causes seizures, provide ways to help users navigate
  - **Understandable**: Make text readable and understandable, make content appear and operate in predictable ways, help users avoid and correct mistakes
  - **Robust**: Maximize compatibility with current and future user tools

- **Implement specific accessibility practices**:
  - **Text alternatives**: Provide alt text for images, transcripts for audio, captions for video
  - **Keyboard accessibility**: Ensure all interactive elements are reachable and operable via keyboard
  - **Focus management**: Provide visible focus indicators and manage focus logically
  - **ARIA labels**: Use ARIA attributes to enhance accessibility when native HTML is insufficient
  - **Color contrast**: Ensure text and UI components meet WCAG 2.2 AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
  - **Responsive text**: Allow text to be resized up to 200% without loss of content or functionality
  - **Touch targets**: Provide minimum 44x44dp touch targets for interactive elements
  - **Motion sensitivity**: Provide option to disable non-essential motion and animation
  - **Time limits**: Allow users to turn off, adjust, or extend time limits

- **Test with diverse users and assistive technologies**:
  - Include users with various disabilities in usability testing
  - Test with screen readers (JAWS, NVDA, VoiceOver), screen magnifiers, speech recognition software
  - Test keyboard-only navigation
  - Test with switch devices and other alternative input methods
  - Test in high contrast modes and with disabled styles

- **Integrate accessibility from the start**:
  - Consider accessibility during ideation and design, not as an afterthought
  - Create accessible design systems and component libraries
  - Train designers and developers on accessibility principles
  - Include accessibility criteria in Definition of Done

## Don't
- Don't treat accessibility as a checklist or compliance exercise only
- Don't assume accessibility features benefit only people with permanent disabilities
- Don't rely solely on automated testing tools—they catch only about 30% of issues
- Don't use placeholder text as labels—they disappear when users start typing
- Don't remove outlines or focus indicators without providing equally visible alternatives
- Don't rely on color alone to convey information, indicate actions, or distinguish elements
- Don't create timed activities that disadvantage users who need more time
- Don't use CAPTCHAs that exclude users with disabilities without providing alternatives
- Don't assume that if it works for you, it works for everyone
- Don't forget about cognitive accessibility—consider language complexity, predictability, and consistency

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Users abandon forms | Poor label association, unclear requirements, or difficult error recovery | Use proper label elements, provide inline validation, and clear error messages |
| Screen reader users miss content | Poor heading structure, missing landmarks, or inappropriate ARIA use | Implement logical heading hierarchy and use semantic HTML |
| Keyboard users get trapped | Missing escape mechanisms or poor focus management | Ensure all modal dialogs can be closed and focus returns appropriately |
| Low contrast text | Color combinations that don't meet WCAG standards | Adjust colors to meet minimum contrast ratios |
| Inaccessible custom widgets | Missing keyboard support or ARIA roles | Use native HTML elements when possible or implement full ARIA support |
| Inconsistent accessibility | Some parts accessible, others not | Create and enforce accessibility standards across the product |
| False sense of security | Passing automated tests but failing manual testing | Combine automated testing with user testing involving people with disabilities |
| Accessibility debt accumulation | Deferring fixes to "later" releases | Treat accessibility bugs with same priority as other critical bugs |

## Verifying
- Check color contrast: verify text and UI components meet WCAG 2.2 AA standards using tools like axe, Lighthouse, or manual inspection
- Test keyboard navigation: ensure all interactive elements are reachable and operable via Tab key
- Test screen reader compatibility: verify content is announced logically and interactable elements are discoverable
- Review ARIA usage: confirm ARIA attributes are used correctly and only when necessary
- Check focus order: verify logical navigation sequence and visible focus indicators
- Validate form accessibility: ensure labels are properly associated, errors are announced, and required fields are marked
- Test video/audio accessibility: confirm captions, transcripts, and audio descriptions are provided
- Assess responsive design: verify usability and accessibility are maintained at different screen sizes
- Review testing process: confirm inclusion of users with disabilities in usability testing
- Check documentation: verify accessibility guidelines are documented and followed