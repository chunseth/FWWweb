interface PauseMenuProps {
  onResume: () => void;
  onNewGame: () => void;
  onShowLeaderboard: (() => void) | null;
  musicEnabled: boolean;
  musicVolume: number;
  onMusicEnabledChange: (enabled: boolean) => void;
  onMusicVolumeChange: (volume: number) => void;
}

/** Pause overlay. The backdrop blurs the board and rack behind it. */
export const PauseMenu = ({
  onResume,
  onNewGame,
  onShowLeaderboard,
  musicEnabled,
  musicVolume,
  onMusicEnabledChange,
  onMusicVolumeChange,
}: PauseMenuProps) => (
  <div className="modal-backdrop modal-backdrop--blur" onClick={onResume}>
    <div className="modal modal--pause" onClick={(e) => e.stopPropagation()}>
      <h2 className="modal__title">Paused</h2>
      <p className="pause__hint">The timer is stopped.</p>
      <div className="pause__music">
        <div className="pause__music-header">
          <span>Music</span>
          <button
            className="pause__music-toggle"
            type="button"
            aria-pressed={!musicEnabled}
            onClick={() => onMusicEnabledChange(!musicEnabled)}
          >
            {musicEnabled ? "Off" : "On"}
          </button>
        </div>
        <label className="pause__volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(musicVolume * 100)}
            disabled={!musicEnabled}
            onChange={(e) =>
              onMusicVolumeChange(Number(e.currentTarget.value) / 100)
            }
          />
          <strong>{Math.round(musicVolume * 100)}%</strong>
        </label>
      </div>
      <div className="pause__actions">
        <button className="btn btn--primary" onClick={onResume}>
          Resume
        </button>
        {onShowLeaderboard ? (
          <button className="btn" onClick={onShowLeaderboard}>
            Leaderboards
          </button>
        ) : null}
        <button className="btn btn--danger" onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
  </div>
);
