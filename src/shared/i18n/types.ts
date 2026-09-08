/**
 * Internationalization types and translation keys for Dream Walker.
 */

export type SupportedLocale = "ru" | "en";

export const DEFAULT_LOCALE: SupportedLocale = "ru";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["ru", "en"];

export type LocalizedText = string | Partial<Record<SupportedLocale, string>>;

export function resolveLocalizedText(
  text: LocalizedText,
  locale: SupportedLocale,
  fallbackLocale: SupportedLocale = DEFAULT_LOCALE,
): string {
  if (typeof text === "string") return text;
  return text[locale] ?? text[fallbackLocale] ?? Object.values(text)[0] ?? "";
}

export interface TranslationSchema {
  ui: {
    language: string;
    lang_ru: string;
    lang_en: string;
    system_label_record: string;
    system_label_clue: string;
    system_label_heart: string;
    back: string;
    close: string;
    step_back: string;
    esc_step_back: string;
    esc_close: string;
    thinking_deal: string;
    thinking_next_cycle: string;
    thinking_mnemonic: string;
    whisper_remembering: string;
    whisper_cycle_restart: string;
    whisper_fallback_mind: string;
    whisper_failed_population: string;
    whisper_burnt_memory: string;
    whisper_time_added: string;
    whisper_no_longer_there: string;
    whisper_following: string;
    whisper_leverage_learned: string;
    unknown_place: string;
    unknown_person: string;
  };
  hud: {
    cycle: string;
  };
  menu: {
    enter_dream: string;
    return_to_dream: string;
    controls: string;
    connection: string;
    mind_prefix: string;
    already_been_here: string;
  };
  controls: {
    title: string;
    section_talking: string;
    section_debug: string;
    music_on: string;
    music_off: string;
    key_walk: string;
    key_interact: string;
    key_cancel: string;
    key_memories: string;
    key_verbs: string;
    key_journal: string;
    key_words: string;
    key_inventory: string;
    key_help: string;
    key_debug: string;
    key_heartbeat: string;
    key_grant: string;
    note_1: string;
    note_2: string;
    note_3: string;
    note_4: string;
  };
  dialogue: {
    placeholder: string;
    mic_label: string;
    keep_memory: string;
    keep_secret: string;
    offer_memory_prefix: string;
    tell_pattern: string;
  };
  verbRing: {
    title: string;
    hint: string;
    confirm: string;
  };
  actionRing: {
    title: string;
    hint: string;
    confirm: string;
  };
  verbs: {
    label: {
      talk: string;
      press: string;
      lead: string;
      kill: string;
    };
    refusal: {
      nobody: string;
      broken: string;
      press_proof: string;
      no_leverage: string;
      unleadable: string;
      already_led: string;
      leading_another: string;
      unkillable: string;
      no_lethal_means: string;
    };
  };
  actions: {
    examine: string;
    take: string;
    drop: string;
    give: string;
    put: string;
    open: string;
    close: string;
    activate: string;
    use: string;
    traverse: string;
  };
  weather: {
    overcast: string;
    drizzle: string;
    dry: string;
    clearing: string;
    clear: string;
    fine: string;
    yesterday: string;
  };
  doors: {
    open: string;
    locked: string;
    sealed: string;
    band: string;
    lever: string;
    reverse: string;
    key_lock: string;
    lever_lock: string;
    puzzle_lock: string;
    default_refusal: string;
  };
  journal: {
    title: string;
    subtitle: string;
    empty: string;
    other_observations: string;
    cycle_entry: string;
    met_in: string;
    noticed_words: string;
    understood_silent: string;
    burned_memory: string;
    left_part_of_self: string;
    said_too_much: string;
    shut_forever: string;
    gave_up_different: string;
    no_longer_exists: string;
    following_you: string;
    named_secret: string;
    empty_wallet: string;
    woke_up_early: string;
    nothing_left_to_spend: string;
    walked_away: string;
    locked_timer: string;
    named_intruder: string;
  };
  clueInspect: {
    title: string;
    placeholder: string;
    note: string;
  };
  wordNotebook: {
    title: string;
    observed: string;
    instruction: string;
    alphabet_note: string;
    placeholder: string;
  };
  memories: {
    onboarding_title: string;
    onboarding_body: string;
    slot_label: string;
    take_with: string;
    wallet_title: string;
    wallet_body: string;
    all_spent: string;
    need_three: string;
  };
  finale: {
    title: string;
    instructions: string;
    submit: string;
    leave: string;
    checking: string;
    door_other_side: string;
    resonance: string;
    locked_ending: string;
    failed_heading: string;
    void_ending: string;
    miss: string;
    locked: string;
    dry: string;
    full: string;
    dream_silent: string;
  };
  connect: {
    title: string;
    desc_codex: string;
    desc_openai: string;
    desc_anthropic: string;
    instructions: string;
    btn_connect: string;
    btn_cancel: string;
    btn_logout: string;
    status_preparing: string;
    status_waiting: string;
    status_ready: string;
    status_disconnected: string;
    status_incompatible: string;
    status_error: string;
    limit_line: string;
    unknown_reset: string;
    model_not_connected: string;
  };
  lobby: {
    room_name: string;
    slogan: string;
    hint: string;
    plaque: string;
    terminal_prompt: string;
    patient_prompt: string;
    controls_prompt: string;
    settings_prompt: string;
    entry_prompt: string;
    entry_ready: string;
    entry_blocked: string;
    patient_title: string;
    patient_category: string;
    patient_body: string;
    settings_title: string;
    settings_category: string;
    settings_body: string;
    settings_reduced: string;
    settings_full: string;
    entry_title: string;
    entry_category: string;
    entry_ready_body: string;
    entry_blocked_body: string;
    entry_start: string;
    entry_train: string;
  };
  debug: {
    head: string;
  };
  interact: {
    talk_to: string;
    more_actions: string;
    look_at: string;
  };
}

export type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKey = NestedKeyOf<TranslationSchema>;
