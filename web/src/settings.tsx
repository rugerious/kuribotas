// The ⚙️ tab: this device's choices as buttons, for people who don't type commands. Every button
// runs the same command a person could type (/tema claro, /abanoes nao…), so there is one way each
// choice works, and the chat confirms it as usual.
import type { Theme } from "./theme.ts";
import type { Lang, Words } from "./words.ts";

export type SettingsNow = {
  theme: Theme;
  quietJoins: boolean;
  shakeOn: boolean;
  nudgeSound: string;
  tornadoSound: string;
  nudgeSounds: string[];
  tornadoSounds: string[];
  push: boolean | "unsupported";
  lang: Lang;
};

// A row of choices that behave like one control: the current one is pressed.
function Choice<T extends string | boolean>({
  label,
  hint,
  options,
  current,
  onPick,
}: {
  label: string;
  hint?: string;
  options: { value: T; text: string }[];
  current: T;
  onPick: (value: T) => void;
}) {
  return (
    <div class="setting" role="group" aria-label={label}>
      <div class="setting-text">
        <span class="setting-label">{label}</span>
        {hint && <span class="setting-hint">{hint}</span>}
      </div>
      <div class="seg">
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === current} onClick={() => onPick(o.value)}>
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SoundPick({
  label,
  id,
  options,
  current,
  onPick,
  onListen,
  listen,
}: {
  label: string;
  id: string;
  options: string[];
  current: string;
  onPick: (name: string) => void;
  onListen: () => void;
  listen: string;
}) {
  return (
    <div class="setting">
      <div class="setting-text">
        <label class="setting-label" for={id}>
          {label}
        </label>
      </div>
      <div class="seg">
        <select id={id} value={current} onChange={(e) => onPick(e.currentTarget.value)}>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button type="button" onClick={onListen}>
          ▶ {listen}
        </button>
      </div>
    </div>
  );
}

export function Settings({
  now,
  w,
  run,
  listen,
}: {
  now: SettingsNow;
  w: Words;
  run: (command: string) => void; // a command, exactly as if typed
  listen: (tornado: boolean) => void;
}) {
  const t = w.settings;
  return (
    <section class="settings" aria-label={t.title}>
      <p class="tips-intro">{t.intro}</p>
      <Choice<Theme>
        label={t.theme}
        hint={t.themeHint}
        options={[
          { value: "escuro", text: t.dark },
          { value: "claro", text: t.light },
          { value: "auto", text: t.auto },
        ]}
        current={now.theme}
        onPick={(v) => run(`/tema ${v}`)}
      />
      <Choice<boolean>
        label={t.joins}
        hint={t.joinsHint}
        options={[
          { value: false, text: t.show },
          { value: true, text: t.hide },
        ]}
        current={now.quietJoins}
        onPick={(quiet) => run(`/entradas ${quiet ? "nao" : "sim"}`)}
      />
      <Choice<boolean>
        label={t.shake}
        hint={t.shakeHint}
        options={[
          { value: true, text: t.on },
          { value: false, text: t.off },
        ]}
        current={now.shakeOn}
        onPick={(on) => run(`/abanoes ${on ? "sim" : "nao"}`)}
      />
      <SoundPick
        label={t.nudgeSound}
        id="set-nudge"
        options={now.nudgeSounds}
        current={now.nudgeSound}
        onPick={(name) => run(`/som ${name}`)}
        onListen={() => listen(false)}
        listen={t.listen}
      />
      <SoundPick
        label={t.tornadoSound}
        id="set-tornado"
        options={now.tornadoSounds}
        current={now.tornadoSound}
        onPick={(name) => run(`/som tornado ${name}`)}
        onListen={() => listen(true)}
        listen={t.listen}
      />
      {now.push === "unsupported" ? (
        <div class="setting">
          <div class="setting-text">
            <span class="setting-label">{t.notify}</span>
            <span class="setting-hint">{t.notifyUnsupported}</span>
          </div>
        </div>
      ) : (
        <Choice<boolean>
          label={t.notify}
          hint={t.notifyHint}
          options={[
            { value: true, text: t.on },
            { value: false, text: t.off },
          ]}
          current={now.push}
          onPick={(on) => run(`/notificacoes ${on ? "sim" : "nao"}`)}
        />
      )}
      <Choice<Lang>
        label={t.lang}
        options={[
          { value: "pt", text: "Português" },
          { value: "en", text: "English" },
        ]}
        current={now.lang}
        onPick={(v) => run(`/lingua ${v}`)}
      />
    </section>
  );
}
