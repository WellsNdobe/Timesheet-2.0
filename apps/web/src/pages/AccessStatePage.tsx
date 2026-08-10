export function AccessStatePage({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return <section className="empty-state" aria-live="polite"><p className="section-kicker">WORKSPACE</p><h1>{title}</h1><p>{message}</p>{onRetry && <button className="primary-button" type="button" onClick={onRetry}>Try again</button>}</section>;
}
