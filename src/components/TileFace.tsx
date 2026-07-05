import { BLANK_LETTER } from "../game/shared/bag";

interface TileFaceProps {
  letter: string;
  value: number;
  isBlank?: boolean;
  isDraft?: boolean;
  isSelected?: boolean;
}

export const TileFace = ({
  letter,
  value,
  isBlank = false,
  isDraft = false,
  isSelected = false,
}: TileFaceProps) => {
  const displayLetter = letter === BLANK_LETTER ? "" : letter;
  const className = [
    "tile",
    isDraft ? "tile--draft" : "",
    isBlank ? "tile--blank" : "",
    isSelected ? "tile--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <span className="tile__letter">{displayLetter}</span>
      {!isBlank && value > 0 ? (
        <span className="tile__value">{value}</span>
      ) : null}
    </div>
  );
};
