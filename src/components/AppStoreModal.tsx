export const APP_STORE_URL =
  "https://apps.apple.com/us/app/friends-with-words/id6759844166";

interface AppStoreModalProps {
  onDismiss: () => void;
}

/** Promotes the native iOS app after a run ends. */
export const AppStoreModal = ({ onDismiss }: AppStoreModalProps) => (
  <div className="modal-backdrop modal-backdrop--promo">
    <div className="modal modal--app-store">
      <img
        className="app-store-modal__icon"
        src="/1024.png"
        alt="Friends With Words"
        width="1024"
        height="1024"
      />
      <p className="app-store-modal__text">
        Thanks for playing the demo! Download the full app today!
      </p>
      <div className="gameover__actions app-store-modal__actions">
        <a
          className="btn btn--primary"
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onDismiss}
        >
          Download on the App Store
        </a>
        <button className="btn btn--ghost" type="button" onClick={onDismiss}>
          OK
        </button>
      </div>
    </div>
  </div>
);
