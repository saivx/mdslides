# MD Slides

A Chrome extension that opens local Markdown files as a slide show. Each `# H1` heading becomes one slide, and the page is styled like GitHub.

## Features

- **Opens `.md` files automatically.** Open any local `.md` or `.markdown` file in Chrome and it loads in the viewer.
- **One H1 per slide.** You can also split on H1 and H2 for documents with few H1 headings.
- **Live reload.** The viewer re-reads the file when it changes, so you can edit in your editor and watch the slides update.
- **Navigation.** Prev/next buttons, a table-of-contents dropdown, jump-to-slide and keyboard shortcuts. An "All pages" mode shows the whole document.
- **Folder sidebar.** Browse the other Markdown files in the same folder.
- **Zoom and fit.** Manual zoom, fit to width, or fit to height so long slides fit one screen.
- **Themes.** GitHub, GitHub Colorful, GitHub Dark, VS Code Dark+, Notion, Solarized and Dracula.
- **Code and tables.** Syntax highlighting with a copy button, sortable tables, and a full-screen table view.
- **Relative links and images.** Links between `.md` files and local images work.
- **Export.** Save as a standalone HTML file or print to PDF, with configurable headers, footers, margins and watermark.

## Installation

The extension isn't on the Chrome Web Store yet, so load it unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Open the extension's **Details** page and turn on **Allow access to file URLs**. This is required to read local files.

## Usage

- Open a local Markdown file in Chrome, for example `file:///D:/notes/talk.md`. It opens in the viewer.
- Or click the toolbar icon, then paste a file path or drop a `.md` file onto the page. Dropped files are a static copy with no live reload.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next slide |
| `Home` / `End` | First / last slide |
| `G` | Jump to slide number |
| `A` | Toggle slides / all pages |
| `B` | Toggle folder sidebar |
| `T` | Cycle theme |
| `+` / `-` / `0` | Zoom in / out / reset |
| `W` / `H` | Fit to width / height |
| `O` | Open a file by path |
| `F` | Full screen |
| `?` | Help |

## Permissions

| Permission | Why |
| --- | --- |
| `file:///*` | Read local Markdown files and images |
| `webNavigation`, `tabs` | Detect navigation to a `.md` file and redirect it to the viewer |
| `storage` | Save your settings and recent files |

Nothing is sent over the network. All rendering happens locally in the browser.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Redirects `.md` navigations to the viewer |
| `viewer.html`, `viewer.css`, `viewer.js` | The viewer UI |
| `marked.min.js` | Markdown parser |
| `highlight.min.js` | Code syntax highlighting |
| `icons/` | Extension icons |

## Credits

Created by **S a i** ([@saivx](https://github.com/saivx)).

Built with these open-source libraries:

- [marked](https://github.com/markedjs/marked) for Markdown parsing
- [highlight.js](https://github.com/highlightjs/highlight.js) for syntax highlighting

UI Themes inspired by GitHub, VS Code, Notion, Solarized and Dracula.

## License
Everyone is free to use this as you please for the greater good.
