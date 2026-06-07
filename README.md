# Audio Switcher for Vicinae

Switch your system audio in seconds — right from the [Vicinae](https://vicinae.com)
launcher. List your output and input devices, set the active one ("scharf stellen"),
and route individual apps (e.g. send Chromium to your headphones for a meeting)
without ever opening a mixer.

Built for **PipeWire + WirePlumber** (the default on modern Linux desktops).
No `pactl` required — it uses `wpctl`, `pw-dump` and `pw-metadata`.

## Commands

All commands show up in Vicinae's main search, so just start typing:

| Command | Type… | What it does |
| --- | --- | --- |
| **Set Audio Output** | `set output audio` | Pick a speaker/headphone as the default output. Sets it and closes instantly. |
| **Set Audio Input** | `set input audio` / `mic` | Pick a microphone as the default input. |
| **Route App Audio** | `route app` / app name | See what's currently playing and send a single app to any device. |
| **Audio Devices** | `audio devices` | All-in-one hub: outputs, inputs and currently-playing apps in one list. |

### Actions

- **Enter** — set the selected device as default (output/input).
- **⌘M** — mute / unmute the selected device.
- **⌘↑ / ⌘↓** — volume up / down (capped at 150 %).
- **⌘R** — refresh.
- On an app stream: **Route to Device…** to pin it to a specific output/input,
  or **Follow Default Device** to un-pin it.

The current default is marked with a green check; volume and mute state are shown
as accessories.

## Requirements

- A running **PipeWire** sound server with **WirePlumber**.
- The PipeWire CLI tools, which ship with PipeWire:
  - `wpctl` (package `wireplumber`)
  - `pw-dump`, `pw-metadata` (package `pipewire` / `pipewire-utils`)
- Vicinae (any recent version).

Check that the tools exist:

```sh
command -v wpctl pw-dump pw-metadata
```

## Install

### Option A — prebuilt release (no Node.js needed)

```sh
curl -fsSL https://raw.githubusercontent.com/nurkert/vicinae-audio/main/install.sh | bash
```

This downloads the latest release and extracts it to
`~/.local/share/vicinae/extensions/audio-switcher`. Vicinae loads it
automatically — no restart required.

Prefer to do it by hand? Grab the `audio-switcher-<version>.tar.gz` from the
[Releases page](https://github.com/nurkert/vicinae-audio/releases) and extract
it into `~/.local/share/vicinae/extensions/`.

### Option B — build from source

```sh
git clone https://github.com/nurkert/vicinae-audio.git
cd vicinae-audio
npm install
npm run build      # builds straight into your Vicinae extensions directory
```

## Development

```sh
npm install
npm run dev        # live-reloading dev session (vici develop)
```

`npm run dev` registers the extension with the running Vicinae instance and
rebuilds on every change.

## How it works

- **Listing** — `pw-dump` (JSON) for the device/stream graph, enriched with
  volume/mute/default info parsed from `wpctl status`.
- **Setting the default** — `wpctl set-default <id>`.
- **Volume / mute** — `wpctl set-volume` / `wpctl set-mute`.
- **Per-app routing** — `pw-metadata <stream-id> target.object "<node.name>"`
  pins a stream to a device; deleting that key (`pw-metadata -d`) makes it
  follow the default again.

## Releasing

Releases are produced by GitHub Actions. Tag a version and push it:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The `Release` workflow builds the extension, packages it as a `.zip` and
`.tar.gz`, and publishes a GitHub Release with those assets.

## License

[MIT](LICENSE)
