"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconMic, IconStop, IconVolume } from "@/components/ui/icons";
import { BTN_SM, FOCUS } from "@/components/ui/styles";
import { deviceOptions, selectedOption, useDeviceList } from "@/lib/devices/list";
import { litBars } from "@/lib/devices/meter";
import {
  isMicTestRunning,
  MIC_TEST_MS,
  resetMicTest,
  startMicTest,
  stopMicTest,
  useMicTest,
} from "@/lib/devices/micTest";
import { currentMediaSupport, problemText } from "@/lib/devices/permissions";
import { useDevicePrefs } from "@/lib/devices/prefs";
import { playTimerStart } from "@/lib/game/sfx";
import { CheckCard, DevicePicker, Pill, ProblemNote, Purpose, STAGE } from "./parts";

const BARS = 18;
/** Bar heights rise left to right, like a signal-strength meter. */
const BAR_HEIGHT = Array.from({ length: BARS }, (_, i) => 28 + Math.round((i / (BARS - 1)) * 72));

/**
 * The microphone check, on the "Before you go in" step and the menu's Camera and microphone
 * panels: what it's for, then "Test microphone", which opens it for at most MIC_TEST_MS, shows a
 * live level and says "Sounds good" once it hears you (lib/devices/micTest.ts). The microphone is
 * always let go again: when the test ends, on Stop, or when this check closes. Nothing is
 * recorded or sent. Also a "Play a test sound" for the speakers.
 */
export function MicCheck() {
  const status = useMicTest((s) => s.status);
  const level = useMicTest((s) => s.level);
  const heard = useMicTest((s) => s.heard);
  const problem = useMicTest((s) => s.problem);
  const openId = useMicTest((s) => s.deviceId);
  const choice = useDevicePrefs((s) => s.mic);
  const micId = useDevicePrefs((s) => s.micId);
  const devices = useDeviceList((s) => s.devices);
  const [support] = useState(currentMediaSupport);
  const [played, setPlayed] = useState(false);

  // Fresh each time the check opens, and never left listening after it closes.
  useEffect(() => {
    resetMicTest();
    return stopMicTest;
  }, []);

  const listening = status === "listening";
  const busy = status === "opening" || listening;
  const options = deviceOptions(devices, "mic");
  const picked = selectedOption(devices, "mic", listening ? openId : null, micId);
  const pick = (id: string) => {
    useDevicePrefs.getState().setMicId(id);
    if (isMicTestRunning()) void startMicTest();
  };

  const lit = listening ? litBars(level, BARS) : 0;
  const seconds = Math.round(MIC_TEST_MS / 1000);
  const caption =
    support !== "ok"
      ? null
      : status === "opening"
        ? "Opening your microphone…"
        : listening
          ? heard
            ? "Sounds good"
            : "Say something, the bars should move"
          : status === "done"
            ? heard
              ? "Sounds good. Your microphone is off again."
              : "Didn't hear anything. Is it muted? Test again, or pick another one."
            : status === "error"
              ? null
              : choice === "ok"
                ? "It worked last time. Test again if you like."
                : `Press Test microphone and say something. It listens for ${seconds} seconds at most.`;
  const note =
    support !== "ok"
      ? problemText(support, "mic")
      : status === "error" && problem
        ? problemText(problem, "mic")
        : null;

  const pill = busy ? (
    <Pill tone="live">Listening</Pill>
  ) : heard || (status === "idle" && choice === "ok") ? (
    <Pill tone="good">Sounds good</Pill>
  ) : choice === "skipped" ? (
    <Pill tone="muted">Skipped</Pill>
  ) : (
    <Pill tone="muted">Not tested</Pill>
  );

  return (
    <CheckCard
      id="check-mic"
      icon={<IconMic size={22} strokeWidth={2.5} />}
      title="Microphone"
      status={pill}
    >
      <Purpose privacy="Your voice is only sent while you're talking to her, to turn it into text.">
        Talk out loud to Ms. Fenwick, the librarian, and try your voice mask in the Character
        Studio.
      </Purpose>

      <div
        className={`${STAGE} mt-3 flex flex-col items-center justify-center gap-3 bg-surface px-5`}
      >
        <div
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={BARS}
          aria-valuenow={lit}
          className="flex h-[45%] w-full max-w-[19rem] items-end justify-between gap-1"
        >
          {BAR_HEIGHT.map((h, i) => (
            <span
              key={i}
              aria-hidden
              style={{ height: `${h}%` }}
              className={`w-full rounded-full border-2 transition-colors duration-75 motion-reduce:transition-none ${i < lit ? (heard ? "border-walnut bg-leaf" : "border-walnut bg-sun") : "border-walnut/20 bg-canvas"}`}
            />
          ))}
        </div>
        <div aria-live="polite" className="w-full text-center">
          {note ? (
            <ProblemNote>{note}</ProblemNote>
          ) : (
            caption && (
              <p className="inline-flex items-center gap-1.5 font-display text-[15px] leading-5 font-semibold text-walnut">
                {heard && (
                  <span
                    aria-hidden
                    className="grid h-5 w-5 place-items-center rounded-full border-2 border-walnut bg-leaf"
                  >
                    <IconCheck size={12} strokeWidth={3.5} />
                  </span>
                )}
                {caption}
              </p>
            )
          )}
        </div>
      </div>

      {support === "ok" && (
        <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
          {busy ? (
            <button type="button" onClick={stopMicTest} className={BTN_SM.secondary}>
              <IconStop size={15} strokeWidth={2.5} />
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void startMicTest()}
                className={BTN_SM.secondary}
              >
                <IconMic size={16} strokeWidth={2.5} />
                {status === "error"
                  ? "Try again"
                  : status === "done" || choice === "ok"
                    ? "Test again"
                    : "Test microphone"}
              </button>
              <button
                type="button"
                aria-pressed={choice === "skipped"}
                onClick={() => useDevicePrefs.getState().setMic("skipped")}
                className={BTN_SM.quiet}
              >
                {choice === "skipped" && <IconCheck size={15} strokeWidth={3} />}
                Skip
              </button>
            </>
          )}
          {options.length > 1 && (
            <DevicePicker label="Microphone" options={options} value={picked} onChange={pick} />
          )}
        </div>
      )}

      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[13px] leading-5 font-medium text-ink-soft">
        <button
          type="button"
          onClick={() => {
            playTimerStart();
            setPlayed(true);
          }}
          className={`-ml-1 inline-flex items-center gap-1.5 rounded-[8px] px-1 font-display text-[13.5px] font-semibold text-walnut underline decoration-2 underline-offset-2 hover:text-tangerine ${FOCUS}`}
        >
          <IconVolume size={16} strokeWidth={2.5} />
          {played ? "Play it again" : "Play a test sound"}
        </button>
        <span aria-live="polite">
          {played ? "You should hear two short beeps." : "Checks your speakers."}
        </span>
      </p>
    </CheckCard>
  );
}
