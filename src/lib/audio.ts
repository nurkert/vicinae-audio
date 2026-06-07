import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export type DeviceKind = "sink" | "source";
export type StreamKind = "playback" | "record";

export interface AudioDevice {
  /** PipeWire node id, used by wpctl set-default / set-volume / set-mute */
  id: number;
  /** Stable identifier (node.name) used as a routing target */
  nodeName: string;
  /** Human readable name (node.description) */
  name: string;
  kind: DeviceKind;
  isDefault: boolean;
  /** Volume in the 0..1 range, or -1 if unknown */
  volume: number;
  muted: boolean;
}

export interface AudioStream {
  /** PipeWire node id of the stream */
  id: number;
  /** Application name, e.g. "Chromium", "Firefox" */
  app: string;
  /** What is playing, e.g. a track or tab title */
  media: string;
  kind: StreamKind;
  /** Device id this stream is currently linked to, or null if not linked yet */
  deviceId: number | null;
  /** Friendly name of the device the stream currently uses */
  deviceName: string | null;
  /** Whether the stream is pinned to a device (vs. following the default) */
  pinned: boolean;
}

export interface AudioState {
  sinks: AudioDevice[];
  sources: AudioDevice[];
  streams: AudioStream[];
}

async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await pExecFile(cmd, args, { timeout: 5000 });
  return stdout;
}

/** Parse `wpctl status` into a map of node id -> { volume, muted, isDefault }. */
function parseWpctl(out: string): Map<number, { volume: number; muted: boolean; isDefault: boolean }> {
  const map = new Map<number, { volume: number; muted: boolean; isDefault: boolean }>();
  let inAudio = false;
  let inDevices = false;

  for (const raw of out.split("\n")) {
    const head = raw.trim();
    if (/^Audio$/.test(head)) { inAudio = true; continue; }
    if (inAudio && /^(Video|Settings)\b/.test(head)) break;
    if (!inAudio) continue;

    const line = raw.replace(/[│├└─]/g, " ");
    const label = line.trim();
    if (/^Sinks:/.test(label) || /^Sources:/.test(label)) { inDevices = true; continue; }
    if (/^(Devices|Filters|Streams|Clients):/.test(label)) { inDevices = false; continue; }
    if (!inDevices) continue;

    const m = line.match(/^\s*(\*)?\s*(\d+)\.\s+.+?\s+\[(.+?)\]\s*$/);
    if (!m) continue;
    const bracket = m[3];
    const vol = bracket.match(/vol:\s*([\d.]+)/);
    map.set(parseInt(m[2], 10), {
      isDefault: m[1] === "*",
      volume: vol ? parseFloat(vol[1]) : -1,
      muted: /MUTED/i.test(bracket),
    });
  }
  return map;
}

interface PwNode {
  id: number;
  type?: string;
  info?: {
    props?: Record<string, unknown>;
    "output-node-id"?: number;
    "input-node-id"?: number;
  };
}

function prop(n: PwNode, key: string): string {
  const v = n.info?.props?.[key];
  return v == null ? "" : String(v);
}

/** Collect the full audio state from pw-dump (+ wpctl for volume/mute). */
export async function getState(): Promise<AudioState> {
  const [dumpRaw, statusRaw] = await Promise.all([run("pw-dump", []), run("wpctl", ["status"])]);
  const dump: PwNode[] = JSON.parse(dumpRaw);
  const wp = parseWpctl(statusRaw);

  const links: PwNode[] = [];
  const nodeById = new Map<number, PwNode>();
  for (const o of dump) {
    if (o.type === "PipeWire:Interface:Link") links.push(o);
    else if (o.type === "PipeWire:Interface:Node") nodeById.set(o.id, o);
  }

  const toDevice = (n: PwNode, kind: DeviceKind): AudioDevice => {
    const extra = wp.get(n.id);
    return {
      id: n.id,
      nodeName: prop(n, "node.name"),
      name: prop(n, "node.description") || prop(n, "node.nick") || prop(n, "node.name"),
      kind,
      isDefault: extra?.isDefault ?? false,
      volume: extra?.volume ?? -1,
      muted: extra?.muted ?? false,
    };
  };

  const sinks: AudioDevice[] = [];
  const sources: AudioDevice[] = [];
  const streams: AudioStream[] = [];

  for (const n of nodeById.values()) {
    const mc = prop(n, "media.class");
    if (mc === "Audio/Sink") sinks.push(toDevice(n, "sink"));
    else if (mc === "Audio/Source") sources.push(toDevice(n, "source"));
    else if (mc === "Stream/Output/Audio" || mc === "Stream/Input/Audio") {
      // Skip passive monitor taps such as pavucontrol's "Peak detect" meters.
      if (prop(n, "stream.monitor") === "true") continue;
      const kind: StreamKind = mc === "Stream/Output/Audio" ? "playback" : "record";
      // Resolve the device the stream is currently linked to. For playback the
      // stream is the link OUTPUT and the sink is the INPUT; for record it's
      // the reverse.
      let deviceId: number | null = null;
      for (const l of links) {
        if (kind === "playback" && l.info?.["output-node-id"] === n.id) {
          deviceId = l.info?.["input-node-id"] ?? null;
          break;
        }
        if (kind === "record" && l.info?.["input-node-id"] === n.id) {
          deviceId = l.info?.["output-node-id"] ?? null;
          break;
        }
      }
      const dev = deviceId != null ? nodeById.get(deviceId) : undefined;
      streams.push({
        id: n.id,
        app: prop(n, "application.name") || prop(n, "node.name") || "Unknown app",
        media: prop(n, "media.name"),
        kind,
        deviceId,
        deviceName: dev ? prop(dev, "node.description") || prop(dev, "node.name") : null,
        pinned: prop(n, "target.object") !== "" || prop(n, "target.node") !== "",
      });
    }
  }

  const byName = (a: AudioDevice, b: AudioDevice) => a.name.localeCompare(b.name);
  sinks.sort(byName);
  sources.sort(byName);
  return { sinks, sources, streams };
}

/** Make a device the default for its kind ("scharf stellen"). */
export async function setDefault(id: number): Promise<void> {
  await run("wpctl", ["set-default", String(id)]);
}

export async function toggleMute(id: number): Promise<void> {
  await run("wpctl", ["set-mute", String(id), "toggle"]);
}

/** Adjust volume, e.g. step = "5%+" or "5%-". Capped at 150%. */
export async function adjustVolume(id: number, step: string): Promise<void> {
  await run("wpctl", ["set-volume", "-l", "1.5", String(id), step]);
}

/** Route a single application stream to a specific device (by stable node.name). */
export async function routeStream(streamId: number, targetNodeName: string): Promise<void> {
  await run("pw-metadata", [String(streamId), "target.object", targetNodeName]);
}

/** Clear a stream's pinned target so it follows the default device again. */
export async function resetStream(streamId: number): Promise<void> {
  await run("pw-metadata", ["-d", String(streamId), "target.object"]);
  // target.node is deprecated but some apps set it; clear it too if present.
  try {
    await run("pw-metadata", ["-d", String(streamId), "target.node"]);
  } catch {
    /* ignore */
  }
}
