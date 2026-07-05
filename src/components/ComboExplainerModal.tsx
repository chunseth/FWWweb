interface ComboExplainerModalProps {
  onStart: () => void;
}

/** One-time explainer shown before a player's first run. */
export const ComboExplainerModal = ({ onStart }: ComboExplainerModalProps) => (
  <div className="modal-backdrop modal-backdrop--blur">
    <div className="modal">
      <h2 className="modal__title">Combo Bonuses</h2>
      <div className="combo-explainer">
        <p>
          Score <strong>20+ points</strong> on a turn to build a streak.
        </p>
        <p>
          From your <strong>3rd streak turn</strong> onward, every 20+ turn
          pays a growing bonus:
        </p>
        <div className="combo-explainer__table">
          <div className="combo-explainer__row">
            <span className="combo-chip">×3</span>
            <span>+2 bonus</span>
          </div>
          <div className="combo-explainer__row">
            <span className="combo-chip">×4</span>
            <span>+4 bonus</span>
          </div>
          <div className="combo-explainer__row">
            <span className="combo-chip">×5</span>
            <span>+6 bonus… and climbing</span>
          </div>
        </div>
        <p className="combo-explainer__note">
          A turn under 20 points (or a swap) resets the streak. Watch the 🔥
          counter next to your score.
        </p>
      </div>
      <div className="gameover__actions">
        <button className="btn btn--primary" onClick={onStart}>
          Got it — let's play!
        </button>
      </div>
    </div>
  </div>
);
