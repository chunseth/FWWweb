const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface BlankLetterPickerProps {
  onPick: (letter: string) => void;
  onCancel: () => void;
}

export const BlankLetterPicker = ({ onPick, onCancel }: BlankLetterPickerProps) => (
  <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <h2 className="modal__title">Choose a letter</h2>
      <div className="blank-grid">
        {LETTERS.map((letter) => (
          <button key={letter} onClick={() => onPick(letter)}>
            {letter}
          </button>
        ))}
      </div>
    </div>
  </div>
);
