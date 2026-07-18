# Local Chrome Install

Use these steps from the FluentFrame project directory:

```bash
cd ~/programming/OctopusGarage/fluent-frame
pnpm local:install
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

```text
/Users/kingsonwu/programming/OctopusGarage/fluent-frame/apps/extension/dist
```

5. Chrome will show a new FluentFrame extension card. Copy its extension ID.
6. Back in terminal, run:

```bash
pnpm link:chrome <extension-id>
pnpm run doctor
```

Example:

```bash
pnpm link:chrome anmliiapeifpfadipoenpompbjhkfill
pnpm run doctor
```

When `doctor` says `FluentFrame is ready`, open YouTube and click the FluentFrame
extension button or the in-video control.

For future updates:

```bash
cd ~/programming/OctopusGarage/fluent-frame
pnpm local:update
```

Then go to `chrome://extensions` and click Reload on FluentFrame.
