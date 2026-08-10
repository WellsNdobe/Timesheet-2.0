import { Icon } from "../components/Icon";
import { useThemePreference, type ThemePreference } from "../theme";

const options: Array<{ value: ThemePreference; label: string; detail: string }> = [
  { value: "light", label: "Light", detail: "Use the light workspace appearance." },
  { value: "dark", label: "Dark", detail: "Use the darker workspace appearance." },
  { value: "system", label: "System", detail: "Follow your device or browser preference." },
];

export function SettingsPage() {
  const { preference, changePreference } = useThemePreference();
  return <><header className="content-header"><div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /></p><h1>Settings</h1><p className="page-subtitle">Choose how TempoLedger should look while you work.</p></div></header><section className="panel settings-card" aria-labelledby="appearance-title"><div className="settings-card__heading"><p className="section-kicker">APPEARANCE</p><h2 id="appearance-title">Theme</h2><p>Light, dark, or follow your system setting. Your choice is saved on this device.</p></div><fieldset className="theme-options"><legend className="visually-hidden">Theme preference</legend>{options.map((option) => <label className={`theme-option ${preference === option.value ? "theme-option--selected" : ""}`} key={option.value}><input type="radio" name="theme-preference" value={option.value} checked={preference === option.value} onChange={() => changePreference(option.value)} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset></section></>;
}
