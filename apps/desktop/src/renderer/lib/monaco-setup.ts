// Configuration de Monaco compatible avec la CSP stricte (`script-src 'self'`, pas d'eval) :
// - le worker de l'éditeur est importé via `?worker` : Vite l'émet comme fichier distinct de même origine
//   (aucun blob:, aucun data:) ;
// - on reprend les contributions de `editor.main` SANS les services de langage lourds (TypeScript, JSON, CSS, HTML
//   et leurs workers) ni le client LSP : seule la coloration syntaxique (Monarch, sans worker) est embarquée,
//   pour une liste courte de langages utiles. Chaque langage est chargé à la demande (import dynamique).
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import * as monaco from "monaco-editor/editor/editor.api.js";

import "monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/caretOperations/browser/transpose.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-editor/editor/contrib/codelens/browser/codelensController.js";
import "monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution.js";
import "monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution.js";
import "monaco-editor/editor/contrib/dnd/browser/dnd.js";
import "monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols.js";
import "monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/fontZoom/browser/fontZoom.js";
import "monaco-editor/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js";
import "monaco-editor/editor/contrib/gpu/browser/gpuActions.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution.js";
import "monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution.js";
import "monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress.js";
import "monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace.js";
import "monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine.js";
import "monaco-editor/editor/standalone/browser/inspectTokens/inspectTokens.js";
import "monaco-editor/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js";
import "monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing.js";
import "monaco-editor/editor/contrib/links/browser/links.js";
import "monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper.js";
import "monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js";
import "monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js";
import "monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js";
import "monaco-editor/editor/contrib/rename/browser/rename.js";
import "monaco-editor/editor/contrib/sectionHeaders/browser/sectionHeaders.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens.js";
import "monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions.js";
import "monaco-editor/editor/standalone/browser/toggleHighContrast/toggleHighContrast.js";
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js";
import "monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations.js";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js";
import "monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js";
import "monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/common/standaloneStrings.js";

// Langages (coloration seulement).
import "monaco-editor/languages/definitions/typescript/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/scss/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import "monaco-editor/languages/definitions/dockerfile/register.js";
import "monaco-editor/languages/definitions/sql/register.js";
import "monaco-editor/languages/definitions/rust/register.js";
import "monaco-editor/languages/definitions/go/register.js";
import "monaco-editor/languages/definitions/xml/register.js";
import "monaco-editor/languages/definitions/ini/register.js";

(globalThis as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  // Un seul worker (éditeur) : les autres langages n'en ont pas besoin.
  getWorker: () => new EditorWorker(),
};

/** Langage Monaco pour un chemin, d'après les extensions enregistrées ; JSON coloré comme JavaScript. */
export function languageFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "javascript";
  const base = lower.split("/").pop() ?? lower;
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === base)) return lang.id;
    if (lang.extensions?.some((ext) => lower.endsWith(ext.toLowerCase()))) return lang.id;
  }
  return "plaintext";
}

export { monaco };

// Thèmes de l'éditeur accordés aux thèmes de l'interface.
monaco.editor.defineTheme("nexus-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7286", fontStyle: "italic" },
    { token: "keyword", foreground: "c792ea" },
    { token: "string", foreground: "a5d6a7" },
    { token: "number", foreground: "f78c6c" },
    { token: "type", foreground: "82aaff" },
  ],
  colors: {
    "editor.background": "#0e1016",
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": "#3d4252",
    "editorLineNumber.activeForeground": "#9aa1b2",
    "editorGutter.background": "#0e1016",
    "editor.selectionBackground": "#7c6cff40",
    "editorCursor.foreground": "#a598ff",
    "editorIndentGuide.background1": "#ffffff0d",
    "editorWidget.background": "#151821",
    "editorWidget.border": "#ffffff14",
    "minimap.background": "#0e1016",
    "scrollbarSlider.background": "#ffffff14",
    "scrollbarSlider.hoverBackground": "#ffffff22",
    "diffEditor.insertedTextBackground": "#3fb95026",
    "diffEditor.removedTextBackground": "#f8514926",
  },
});
monaco.editor.defineTheme("nexus-light", {
  base: "vs",
  inherit: true,
  rules: [{ token: "comment", foreground: "8a8f9c", fontStyle: "italic" }],
  colors: {
    "editor.background": "#ffffff",
    "editor.lineHighlightBackground": "#0000000a",
    "editorLineNumber.foreground": "#b5b9c4",
    "editor.selectionBackground": "#7c6cff33",
    "editorCursor.foreground": "#5b4cf0",
  },
});

export function applyMonacoTheme(theme: "dark" | "light"): void {
  monaco.editor.setTheme(theme === "dark" ? "nexus-dark" : "nexus-light");
}
