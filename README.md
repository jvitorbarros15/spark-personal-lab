# Spark — Personal lab

A small, private-by-default idea workspace you run on your computer. Capture ideas, map problems, track technologies, run experiments, and keep notes. No account, API key, installation of packages, or paid service is required.

## Run locally

Install **Node.js 18 or newer** if it is not already installed.

On Windows, double-click **Start Spark.cmd**. It starts Spark and opens your browser.

Or open a terminal in this folder and run:

```sh
npm start
```

Visit **http://127.0.0.1:4173**. Keep the terminal window open while using Spark. Press **Ctrl+C** to stop. `npm run dev` starts the same local server. To run without opening a browser, use `node server.cjs`.

The server listens only on your computer's loopback address. It uses port **4173** consistently so the browser finds the same workspace each time. If Spark is already running, open the address above instead of starting another copy. No build step or `npm install` is needed. Fonts use your computer's system fonts; the application makes no external network requests.

## Your ideas and backups

Your entries are stored in **this browser's local storage**, not in files in this repository. Use the same browser/profile and the exact address `http://127.0.0.1:4173` each time. Using `localhost`, another port, a different browser, or a different profile creates a separate workspace. Private browsing and clearing site data can erase entries. GitHub does not back up your personal entries, and the app does not sync across devices.

Choose **Manage data → Export workspace** regularly to download a JSON backup. Use **Import JSON** to restore or move that backup. Import asks before replacing your current workspace; export first if you want to preserve it. Keep backups somewhere safe and outside a public GitHub repository if they contain private information.

The initial entries are clearly labeled editable examples. Editing one makes it your own. **Manage data → Clear example entries** removes only untouched examples.

## Use your lab

- Capture an idea, problem, technology, experiment, or note from the capture dialog.
- Open any entry to edit its title, notes, category, or stage; link it to an idea.
- Move ideas through Spark, Exploring, Validating, Building, Done, or Parked.
- Experiments start with prompts for a hypothesis, test plan, success criteria, and results.
- Search across the workspace or filter a section by stage.
- Delete an entry after confirming. Connected entries remain available.

## Verify the app

```sh
npm test
```

This checks JavaScript syntax, workspace interactions with a simulated DOM, and real local HTTP responses including path traversal rejection. Automated tests do not replace visual browser testing.

## Files and GitHub

The complete app is in `dist/`; `server.cjs` serves it locally. Commit the application, launcher, README, and tests to your own GitHub repository. The `.gitignore` excludes hosting metadata, environment files, dependencies, and temporary artifacts. The optional `.openai/` folder is not needed to run Spark.

This repository contains application source and examples. Personal workspace entries remain in your browser unless you explicitly export and commit them.
