import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  closeMainWindow,
  showToast,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import {
  AudioDevice,
  AudioState,
  AudioStream,
  adjustVolume,
  getState,
  resetStream,
  routeStream,
  setDefault,
  toggleMute,
} from "./audio";

const EMPTY: AudioState = { sinks: [], sources: [], streams: [] };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Load the audio state and expose a `reload` for refreshing after actions. */
export function useAudio() {
  const [state, setState] = useState<AudioState>(EMPTY);
  const [isLoading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setState(await getState());
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not read audio devices",
        message: errMsg(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, isLoading, reload };
}

function volumePercent(v: number): string {
  return v < 0 ? "" : `${Math.round(v * 100)}%`;
}

const HEADPHONE_HINT = /head|phone|jabra|evolve|buds|airpod|wh-|hd \d|beats|sony|bose/i;

function deviceIcon(d: AudioDevice): Icon | { source: Icon; tintColor: Color } {
  if (d.isDefault) return { source: Icon.CheckCircle, tintColor: Color.Green };
  if (d.muted) return d.kind === "sink" ? Icon.SpeakerOff : Icon.MicrophoneDisabled;
  if (d.kind === "source") return Icon.Microphone;
  return HEADPHONE_HINT.test(d.name) ? Icon.Headphones : Icon.Speaker;
}

function deviceAccessories(d: AudioDevice): List.Item.Accessory[] {
  const acc: List.Item.Accessory[] = [];
  if (d.muted) acc.push({ tag: { value: "Muted", color: Color.Red } });
  const pct = volumePercent(d.volume);
  if (pct) acc.push({ text: pct });
  if (d.isDefault) acc.push({ tag: { value: "Default", color: Color.Green } });
  return acc;
}

async function toast(style: Toast.Style, title: string, message?: string) {
  await showToast({ style, title, message });
}

/** A single output/input device with set-default, mute and volume actions. */
export function DeviceItem(props: {
  device: AudioDevice;
  reload: () => Promise<void>;
  /** Close the launcher right after setting the default (snappy switching). */
  closeOnSet?: boolean;
}) {
  const { device: d, reload, closeOnSet } = props;
  const setLabel = d.kind === "sink" ? "Set as Output" : "Set as Input";
  const kindWord = d.kind === "sink" ? "Output" : "Input";

  const makeDefault = async () => {
    try {
      await setDefault(d.id);
      await toast(Toast.Style.Success, `${kindWord}: ${d.name}`);
      if (closeOnSet) {
        await closeMainWindow();
      } else {
        await reload();
      }
    } catch (e) {
      await toast(Toast.Style.Failure, "Failed to set device", errMsg(e));
    }
  };

  const mute = async () => {
    try {
      await toggleMute(d.id);
      await reload();
    } catch (e) {
      await toast(Toast.Style.Failure, "Failed to toggle mute", errMsg(e));
    }
  };

  const volume = async (step: string) => {
    try {
      await adjustVolume(d.id, step);
      await reload();
    } catch (e) {
      await toast(Toast.Style.Failure, "Failed to change volume", errMsg(e));
    }
  };

  return (
    <List.Item
      title={d.name}
      icon={deviceIcon(d)}
      accessories={deviceAccessories(d)}
      keywords={[d.kind, kindWord, d.nodeName]}
      actions={
        <ActionPanel>
          {!d.isDefault && (
            <Action title={setLabel} icon={Icon.CheckCircle} onAction={makeDefault} />
          )}
          <Action
            title={d.muted ? "Unmute" : "Mute"}
            icon={d.muted ? Icon.SpeakerOn : Icon.SpeakerOff}
            shortcut={{ modifiers: ["cmd"], key: "m" }}
            onAction={mute}
          />
          <Action
            title="Volume Up"
            icon={Icon.SpeakerUp}
            shortcut={{ modifiers: ["cmd"], key: "arrowUp" }}
            onAction={() => volume("5%+")}
          />
          <Action
            title="Volume Down"
            icon={Icon.SpeakerDown}
            shortcut={{ modifiers: ["cmd"], key: "arrowDown" }}
            onAction={() => volume("5%-")}
          />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={reload}
          />
          <Action.CopyToClipboard
            title="Copy Device Name"
            content={d.name}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}

/** Picker shown when routing an application stream to a specific device. */
function TargetPicker(props: {
  stream: AudioStream;
  devices: AudioDevice[];
  reload: () => Promise<void>;
}) {
  const { stream, devices, reload } = props;
  const { pop } = useNavigation();

  const route = async (d: AudioDevice) => {
    try {
      await routeStream(stream.id, d.nodeName);
      await toast(Toast.Style.Success, `${stream.app} → ${d.name}`);
      await reload();
      pop();
    } catch (e) {
      await toast(Toast.Style.Failure, "Failed to route app", errMsg(e));
    }
  };

  return (
    <List navigationTitle={`Route ${stream.app}`} searchBarPlaceholder="Send this app to…">
      {devices.map((d) => (
        <List.Item
          key={d.id}
          title={d.name}
          icon={deviceIcon(d)}
          accessories={d.id === stream.deviceId ? [{ tag: { value: "Current", color: Color.Blue } }] : []}
          actions={
            <ActionPanel>
              <Action title="Route Here" icon={Icon.ArrowRight} onAction={() => route(d)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

/** A currently-playing (or recording) application stream. */
export function StreamItem(props: {
  stream: AudioStream;
  state: AudioState;
  reload: () => Promise<void>;
}) {
  const { stream: s, state, reload } = props;
  const { push } = useNavigation();
  const targets = s.kind === "playback" ? state.sinks : state.sources;

  const title = s.media && s.media !== "Playback" ? `${s.app} — ${s.media}` : s.app;

  const accessories: List.Item.Accessory[] = [];
  if (s.deviceName) {
    accessories.push({
      icon: s.kind === "playback" ? Icon.Speaker : Icon.Microphone,
      text: s.deviceName,
      tooltip: s.pinned ? "Pinned to this device" : "Following default",
    });
  }
  if (s.pinned) accessories.push({ tag: { value: "Pinned", color: Color.Orange } });

  const reset = async () => {
    try {
      await resetStream(s.id);
      await toast(Toast.Style.Success, `${s.app} follows default again`);
      await reload();
    } catch (e) {
      await toast(Toast.Style.Failure, "Failed to reset routing", errMsg(e));
    }
  };

  return (
    <List.Item
      title={title}
      icon={s.kind === "playback" ? Icon.SpeakerHigh : Icon.Microphone}
      accessories={accessories}
      keywords={[s.app, s.kind === "playback" ? "output" : "input"]}
      actions={
        <ActionPanel>
          <Action
            title="Route to Device…"
            icon={Icon.ArrowRight}
            onAction={() => push(<TargetPicker stream={s} devices={targets} reload={reload} />)}
          />
          {s.pinned && (
            <Action
              title="Follow Default Device"
              icon={Icon.ArrowCounterClockwise}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
              onAction={reset}
            />
          )}
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={reload}
          />
        </ActionPanel>
      }
    />
  );
}

/** Full hub: outputs, inputs and currently-playing apps in one view. */
export function DevicesHub() {
  const { state, isLoading, reload } = useAudio();
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search audio devices & apps…" navigationTitle="Audio Devices">
      <List.Section title="Output" subtitle={`${state.sinks.length}`}>
        {state.sinks.map((d) => (
          <DeviceItem key={d.id} device={d} reload={reload} />
        ))}
      </List.Section>
      <List.Section title="Input" subtitle={`${state.sources.length}`}>
        {state.sources.map((d) => (
          <DeviceItem key={d.id} device={d} reload={reload} />
        ))}
      </List.Section>
      {state.streams.length > 0 && (
        <List.Section title="Playing Now" subtitle={`${state.streams.length}`}>
          {state.streams.map((s) => (
            <StreamItem key={s.id} stream={s} state={state} reload={reload} />
          ))}
        </List.Section>
      )}
    </List>
  );
}

/** Focused list of a single device kind (outputs or inputs). */
export function DeviceListView(props: { kind: "sink" | "source" }) {
  const { state, isLoading, reload } = useAudio();
  const devices = props.kind === "sink" ? state.sinks : state.sources;
  const isOutput = props.kind === "sink";

  return (
    <List
      isLoading={isLoading}
      navigationTitle={isOutput ? "Set Audio Output" : "Set Audio Input"}
      searchBarPlaceholder={isOutput ? "Choose output device…" : "Choose input device…"}
    >
      {!isLoading && devices.length === 0 ? (
        <List.EmptyView
          icon={isOutput ? Icon.Speaker : Icon.Microphone}
          title={isOutput ? "No output devices" : "No input devices"}
          description="No PipeWire audio devices were found."
        />
      ) : (
        devices.map((d) => <DeviceItem key={d.id} device={d} reload={reload} closeOnSet />)
      )}
    </List>
  );
}

/** Focused list of currently-playing apps for quick per-app routing. */
export function AppsView() {
  const { state, isLoading, reload } = useAudio();
  return (
    <List isLoading={isLoading} navigationTitle="Route App Audio" searchBarPlaceholder="Search playing apps…">
      {!isLoading && state.streams.length === 0 ? (
        <List.EmptyView
          icon={Icon.SpeakerHigh}
          title="Nothing is playing"
          description="No application is currently sending or receiving audio."
        />
      ) : (
        state.streams.map((s) => <StreamItem key={s.id} stream={s} state={state} reload={reload} />)
      )}
    </List>
  );
}
