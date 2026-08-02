# meowcaller-cli

CLI tool for making WhatsApp calls with TTS (Text-to-Speech) using [meowcaller-js](https://github.com/bencodess/meowcaller-js) and [Baileys](https://github.com/WhiskeySockets/Baileys).

## Installation

```bash
npm install -g meowcaller-cli
```

Or run directly with npx:
```bash
npx meowcaller-cli +919876543210 "Hello, this is a test message"
```

## Usage

```bash
meowcaller-cli <phone> "message"
```

**Arguments:**
- `<phone>` - Phone number with country code (e.g., `+919876543210`)
- `"message"` - Text message to convert to speech and play during the call

**Example:**
```bash
meowcaller-cli +919876543210 "Hello, this is an automated call from meowcaller CLI"
```

The call will automatically hang up after 3 seconds.

## First Run

On first run, a QR code will be displayed in the terminal. Scan it with WhatsApp on your phone (Settings → Linked Devices → Link a Device) to authenticate.

Credentials are stored locally in the `auth_info/` directory.

## Requirements

- Node.js 20+
- `espeak` (Linux) for TTS: `sudo apt install espeak`
- macOS has built-in `say` command

## How It Works

1. Connects to WhatsApp via Baileys (multi-file auth state)
2. Places a WhatsApp VoIP call using meowcaller-js
3. Converts your text message to speech using system TTS (espeak/say)
4. Plays the audio through the call
5. Automatically hangs up after 3 seconds

## License

MIT