interface PauseMenuProps {
  onResume: () => void;
  onNewGame: () => void;
}

/** Pause overlay. The backdrop blurs the board and rack behind it. */
export const PauseMenu = ({ onResume, onNewGame }: PauseMenuProps) => (
  <div className="modal-backdrop modal-backdrop--blur" onClick={onResume}>
    <div className="modal modal--pause" onClick={(e) => e.stopPropagation()}>
      <h2 className="modal__title">Paused</h2>
      <p className="pause__hint">The timer is stopped.</p>
      <div className="pause__actions">
        <button className="btn btn--primary" onClick={onResume}>
          Resume
        </button>
        <button className="btn btn--danger" onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
  </div>
);
