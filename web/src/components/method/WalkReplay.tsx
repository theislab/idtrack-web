// The controls of a walk's replay on the Method page (lib/method/useReplay.ts): play or pause, a step back, a step on;
// the step it stands on written out beside them (a polite live region).
import type { Replay } from "../../lib/method/useReplay";

export function ReplayControls({ replay, total, readout }: { replay: Replay; total: number; readout: string }) {
  const { cursor, running } = replay;
  return (
    <div className="stage-replay" role="group" aria-label="Replay the walk">
      <button
        type="button"
        className="button button--secondary stage-replay__play"
        onClick={replay.play}
        aria-pressed={running}
      >
        {running ? "Pause" : cursor !== null && cursor < total ? "Continue" : "Replay the walk"}
      </button>
      <button
        type="button"
        className="button button--quiet stage-replay__step"
        disabled={cursor === null || cursor <= 0}
        onClick={replay.back}
      >
        Previous step
      </button>
      <button
        type="button"
        className="button button--quiet stage-replay__step"
        disabled={cursor !== null && cursor >= total}
        onClick={replay.forward}
      >
        Next step
      </button>
      <output className="stage-replay__readout mono" aria-live="polite">
        {readout}
      </output>
    </div>
  );
}
