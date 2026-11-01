# Accessibility

Nexus AI aims to be usable by every developer, including people who rely on a keyboard, a screen reader, magnification
or reduced motion. This statement describes where the project stands today. Nexus AI is preview software and has
**not yet been formally audited** against WCAG.

## Our commitment

- Target conformance: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA for the application UI.
- Accessibility problems are treated as bugs, not as feature requests.
- New UI must be operable with the keyboard, carry accessible names, and respect the user's motion and theme settings.

## What is in place

- **Keyboard**: VS Code-like shortcuts, a command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), quick open (`Ctrl+P`),
  visible focus indicators (`:focus-visible`) and keyboard-navigable file tree, tabs and dialogs.
- **Screen readers**: ARIA roles and labels on icon buttons, dialogs, the file tree (`treeitem`, `aria-expanded`,
  `aria-selected`), radio groups and toggles; live regions for some status updates. Part of these semantics is
  covered by the end-to-end tests (`apps/desktop/e2e/ui.e2e.ts`).
- **Automated checks**: [axe-core](https://github.com/dequelabs/axe-core) scans the main views (welcome screen, command
  palette, workbench, dialogs, settings) in light and dark themes against WCAG 2.0 / 2.1 / 2.2 A and AA rules, in the
  end-to-end tests run in CI (`apps/desktop/e2e/a11y.e2e.ts`). Critical and serious violations fail the build.
- **Reduced motion**: animations and transitions are disabled when the OS requests `prefers-reduced-motion`.
- **Themes and zoom**: light, dark and system themes; interface zoom from the View menu (`Ctrl+=`, `Ctrl+-`, reset).
- **Languages**: English and French, following the OS language on first run.

## Supported environments

| Platform | Status |
| --- | --- |
| Linux (Ubuntu / Debian) | verified platform for the application; Orca not yet tested |
| Windows | experimental build; NVDA / Narrator not yet tested |
| macOS | experimental build; VoiceOver not yet tested |

## Known limitations

- No formal audit yet. Automated checks catch only part of WCAG; they do not replace testing with a keyboard and a
  screen reader, and they skip the Monaco editor and the xterm.js terminal.
- The integrated terminal (xterm.js) and the Monaco editor have their own screen-reader modes, with limitations
  inherited from those components.
- Colour contrast has not been measured systematically in every theme.
- The agent conversation and Orchestra views stream content quickly; announcements to assistive technologies may be
  incomplete.
- Editor and terminal font sizes are fixed; use interface zoom to enlarge them.
- Only English and French are available.

## Reporting a barrier

Open an issue with the [bug report form](https://github.com/Dayifour/nexus/issues/new?template=bug_report.yml) and
include "accessibility" in the title. Please describe what you tried to do, the assistive technology and version you
use, your operating system, and what happened. We aim to acknowledge reports within a week.

Contributions are very welcome — adding automated accessibility tests, contrast fixes and screen-reader testing are
great first contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).
