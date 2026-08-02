# meowcaller-cli

CLI tool for making WhatsApp calls with TTS (Text-to-Speech) using [meowcaller-js](https://github.com/bencodess/meowcaller-js) and [Baileys](https://github.com/WhiskeySockets/Baileys).

## Features

- 🎤 **TTS Calling** - Convert text messages to speech and play them during WhatsApp calls
- 📞 **Auto Hangup** - Automatically ends calls after 3 seconds
- 🔴 **Call Recording** - Records all calls by default (saves as WAV files)
- 📱 **QR Authentication** - First run shows QR code, subsequent runs use saved session

## Installation

```bash
# Run directly with npx (no install needed)
npx github:kujju-bot/meowcaller-cli +919876543210 "Hello, this is a test message"

# Or clone and install locally
git clone https://github.com/kujju-bot/meowcaller-cli
cd meowcaller-cli
npm install
node src/cli.js +919876543210 "Hello, this is a test message"
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

The call will:
1. Connect to WhatsApp (shows QR code on first run)
2. Place a WhatsApp VoIP call to the target number
3. Convert your text message to speech using system TTS
4. Play the audio through the call
5. **Record the incoming audio** from the recipient
6. Automatically hang up after 3 seconds
7. Save the recording to `recordings/call_<phone>_<timestamp>.wav`

## First Run

On first run, a QR code will be displayed in the terminal. Scan it with WhatsApp on your phone:
1. Open WhatsApp
2. Go to Settings → Linked Devices → Link a Device
3. Scan the QR code

Credentials are stored locally in the `auth_info/` directory for subsequent runs.

## Recordings

All calls are recorded by default and saved as WAV files in the `recordings/` directory:
```
recordings/call_919876543210_2026-08-02T09-36-01-123Z.wav
```

The recording captures the **incoming audio** from the call recipient (what they say after answering).

## Requirements

- Node.js 20+
- `espeak` (Linux) for TTS: `sudo apt install espeak`
- macOS has built-in `say` command

## How It Works

1. Connects to WhatsApp via Baileys (multi-file auth state)
2. Places a WhatsApp VoIP call using meowcaller-js
3. Converts your text message to speech using system TTS (espeak/say)
4. Plays the audio through the call
5. Records incoming audio via `call.receive()` sink
6. Automatically hangs up after 3 seconds
7. Saves recording as WAV file

## License

MIT