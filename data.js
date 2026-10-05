"use strict";

const DATA = {
  version: 2,
  storageKey: "tennisMaker.v2.world",
  legacyStorageKey: "tennisMaker.v1.player",
  playerFields: ["name", "hand", "backhand"],
  series: {
    startId: "2017-1",
    periods: { "1": "前半", "2": "後半" },
    label: "{year} {period}", fileLabel: "{year}{period}"
  },
  worldUi: { listMode: "series", sort: "score", lastExportedAt: null },
  listSorts: [
    { id: "score", name: "総合力順" }, { id: "name", name: "名前順" }, { id: "created", name: "登録順" }
  ],
  listModes: [{ id: "series", name: "このシリーズ" }, { id: "all", name: "全選手" }],
  importModes: [{ id: "replace", name: "すべて置き換える" }, { id: "append", name: "選手を追加する" }],
  backup: {
    warningDays: 14, dayMs: 86400000, jsonIndent: 2, mime: "application/json",
    accept: ".json,application/json", fileLabel: "tennis-maker_{year}{month}{day}.json",
    dateLabel: "{year}/{month}/{day}", revokeDelay: 1000
  },
  fonts: { page: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif' },
  historyGraph: {
    width: 640, height: 270, left: 58, right: 38, top: 24, bottom: 62,
    ticks: 4, paddingRatio: 0.15, minPadding: 20, tickSteps: [1, 2, 5, 10], radius: 5, lineWidth: 2,
    rankLabelGap: 8, rankLineDash: "4 4",
    maxLabels: 4, minLabelGap: 80, precision: 10000,
    valueLabelGap: 8, valueBaseline: 4, seriesLabelGap: 20, labelLineHeight: 16, axisBottom: 4
  },
  playerId: { prefix: "p_", radix: 36, randomLength: 4 },
  text: {
    title: "テニス能力メーカー",
    basic: "基本情報", stats: "能力値", styleAndServe: "プレイスタイルとサーブ",
    special: "特殊能力", playStyle: "プレイスタイル", serve: "サーブ",
    frontStats: "表ステータス", backStats: "裏ステータス",
    anonymous: "名無しの選手", overall: "総合", noSkills: "特殊能力なし",
    saveImage: "画像で保存", viewCard: "カードを見る", reset: "初期値に戻す",
    resetConfirm: "このカードの項目を初期値に戻します。名前・利き手・バックハンドは戻りません。よろしいですか？",
    resetDone: "このカードの項目を初期値に戻しました。",
    playerList: "選手一覧", backToList: "← 一覧へ", commonFields: "全シリーズ共通",
    addPlayer: "選手を追加", emptyPlayers: "まだ選手がいません", sort: "並び替え",
    deletePlayer: "この選手を削除", deleteConfirm: "{name}のすべてのカードを削除します。よろしいですか？",
    previousSeries: "前のシリーズ", nextSeries: "次のシリーズ", previousMark: "◀", nextMark: "▶",
    series: "シリーズ", listMode: "一覧の表示", seriesManagement: "シリーズ管理",
    addSeries: "次のシリーズを追加", deleteSeries: "最新シリーズを削除",
    backToPlayer: "← {name}", scoreHistory: "総合力の推移", timeline: "シリーズ年表",
    noCards: "まだカードがありません", createCard: "カードを作成", missingScore: "−",
    graphPoint: "{series}：総合力 {score}、ランク {rank}",
    copyPrevious: "前のシリーズからコピー", copyConfirm: "{series}のカードをコピーして、このカードを上書きします。よろしいですか？",
    copyDone: "前のシリーズのカードをコピーしました。", deleteCard: "このカードを削除",
    deleteCardConfirm: "{series}のカードを削除します。よろしいですか？",
    singleCardHint: "選手ごと削除する場合は選手詳細から削除してください",
    dataManagement: "データ管理", exportJson: "JSONで書き出し", importJson: "JSONを読み込む",
    importMode: "読み込み方法", replaceConfirm: "今のデータをすべて置き換えます。よろしいですか？",
    importDone: "JSONを読み込みました。", importError: "JSONを読み込めませんでした。ファイルの内容を確認してください。",
    jsonExporting: "JSONを書き出し中…", jsonExportError: "JSONを書き出せませんでした。もう一度お試しください。",
    lastExport: "最後の書き出し：{date}", neverExported: "まだ書き出していません",
    backupWarning: "しばらく書き出していません。iPhoneでは保存データが消えることがあるので、書き出しておくと安心です。",
    storageError: "保存できませんでした。JSONで書き出して、データを守ってください。",
    saving: "画像を作成中…", saveHint: "画像を長押しして保存してください",
    download: "PNGをダウンロード", close: "閉じる", imageAlt: "作成した選手カード",
    exportError: "画像を作成できませんでした。通信状況を確認して、もう一度お試しください。",
    conflict: "{removed}を外しました。{selected}とは同時に付けられません。",
    optional: "任意", maxLength: "{max}文字まで", numeric: "{name}の数値", range: "{name}のスライダー",
    separator: "｜", expandMark: "+", collapseMark: "−"
  },
  colors: {
    navy: "#14213D", paper: "#F7F9FC", ball: "#D7F34A", white: "#FFFFFF",
    page: "#EDF1F4", muted: "#667286", line: "#DCE2E9", track: "#E2E7EE",
    shadow: "rgba(20, 33, 61, 0.10)", overlay: "rgba(20, 33, 61, 0.65)",
    goldStart: "#F3D36B", goldEnd: "#D4A62A", goldText: "#3A2A00",
    greatBg: "#1F5FBF", goodBg: "#DCE9FF", goodText: "#1F4F9F",
    rankBg: "#EEF1F5", badBg: "#FDE3E1", badText: "#B3261E"
  },
  textFields: [
    { id: "name", name: "名前", max: 12, initial: "" },
    { id: "nickname", name: "二つ名", max: 14, initial: "", optional: true }
  ],
  basic: {
    hand: [{ id: "right", name: "右利き" }, { id: "left", name: "左利き" }],
    backhand: [{ id: "one", name: "片手", cardName: "片手バック" }, { id: "two", name: "両手", cardName: "両手バック" }],
    surface: [
      { id: "hard", name: "ハード", color: "#2F6FB5", outer: "#3C7D55" },
      { id: "clay", name: "クレー", color: "#B94E2B" },
      { id: "grass", name: "芝", color: "#3C8A4A", stripe: "#45975A" }
    ]
  },
  basicLabels: { hand: "利き手", backhand: "バックハンド", surface: "得意サーフェス" },
  initial: { hand: "right", backhand: "two", surface: "hard", playStyle: "allround", serve: "flat" },
  stats: {
    front: [
      { id: "control", name: "コントロール", desc: "狙ったコースに打ち分ける精度" },
      { id: "power", name: "パワー", desc: "ショットとサーブの威力" },
      { id: "speed", name: "スピード", desc: "フットワークと守備範囲の広さ" }
    ],
    back: [
      { id: "stamina", name: "スタミナ", desc: "長いラリーやフルセットでも落ちない体力" },
      { id: "mental", name: "メンタル", desc: "プレッシャーの中でも崩れない強さ" },
      { id: "net", name: "ネットプレー", desc: "ボレーやスマッシュなど前での上手さ" }
    ],
    min: 1, max: 99, initial: 50
  },
  statRanks: [
    { rank: "S", min: 90, color: "#C8960C" }, { rank: "A", min: 80, color: "#D93A3F" },
    { rank: "B", min: 70, color: "#E8702A" }, { rank: "C", min: 60, color: "#D99A1C" },
    { rank: "D", min: 50, color: "#8FA31E" }, { rank: "E", min: 40, color: "#3E9E5A" },
    { rank: "F", min: 20, color: "#3A86C8" }, { rank: "G", min: 1, color: "#8A8F98" }
  ],
  playStyles: [
    { id: "aggressive", name: "アグレッシブ", desc: "チャンスボールを積極的に叩きにいく攻撃型", icon: "assets/icons/style-aggressive.svg", color: "#B3202E" },
    { id: "defensive", name: "ディフェンシブ", desc: "スライスや深いボールで粘り、相手のミスを待つ", icon: "assets/icons/style-defensive.svg", color: "#1E4FA3" },
    { id: "serve_volley", name: "サーブ＆ボレー", desc: "サーブの後すぐネットに詰めて決めにいく", icon: "assets/icons/style-serve-volley.svg", color: "#17734A" },
    { id: "allround", name: "オールラウンダー", desc: "相手や状況に合わせて戦い方を変える", icon: "assets/icons/style-allround.svg", color: "#B8620E" },
    { id: "trickster", name: "トリックスター", desc: "ドロップ・ロブ・角度で相手を揺さぶる", icon: "assets/icons/style-trickster.svg", color: "#6234B0" }
  ],
  serves: [
    { id: "flat", name: "フラット", desc: "回転が少なく最速。まっすぐ突き刺さる", icon: "assets/icons/serve-flat.svg", color: "#B3202E" },
    { id: "slice", name: "スライス", desc: "横回転で、バウンド後に外へ逃げていく", icon: "assets/icons/serve-slice.svg", color: "#1E4FA3" },
    { id: "kick", name: "スピン（キック）", desc: "縦回転で高く弾み、安定して入る", icon: "assets/icons/serve-kick.svg", color: "#17734A" },
    { id: "twist", name: "ツイスト", desc: "スライスと逆方向に跳ねる変化球", icon: "assets/icons/serve-twist.svg", color: "#6234B0" },
    { id: "under", name: "アンダー", desc: "下から打つ奇襲用のサーブ", icon: "assets/icons/serve-under.svg", color: "#B8620E" }
  ],
  shotSkills: {
    label: "ショット適性", initial: "none",
    levels: [
      { id: "bad", mark: "×", name: "苦手", bonus: -1.0, chip: "bad" },
      { id: "none", mark: "−", name: "普通", bonus: 0 },
      { id: "good", mark: "◯", name: "得意", bonus: 0.5, chip: "good" },
      { id: "great", mark: "◎", name: "大得意", bonus: 1.0, chip: "great" }
    ],
    items: [
      { id: "forehand", name: "フォアハンド" }, { id: "backhand", name: "バックハンド" },
      { id: "volley", name: "ボレー" }, { id: "smash", name: "スマッシュ" },
      { id: "return", name: "リターン" }, { id: "slice_shot", name: "スライス" },
      { id: "drop", name: "ドロップショット" }, { id: "lob", name: "ロブ" },
      { id: "passing", name: "パッシングショット" }
    ]
  },
  rankSkills: {
    label: "ランク能力", initial: "D",
    levels: [
      { rank: "A", bonus: 1.0 }, { rank: "B", bonus: 0.6 }, { rank: "C", bonus: 0.3 },
      { rank: "D", bonus: 0 }, { rank: "E", bonus: -0.3 }, { rank: "F", bonus: -0.6 }, { rank: "G", bonus: -1.0 }
    ],
    items: [
      { id: "clutch", name: "勝負強さ", desc: "ブレークポイントを取り切る力" },
      { id: "vs_left", name: "対左", desc: "左利きの相手との戦いやすさ" },
      { id: "recovery", name: "回復", desc: "試合の合間の疲労回復の早さ" },
      { id: "durability", name: "ケガしにくさ", desc: "ケガへの強さ" }
    ]
  },
  gold: { label: "ゴールド能力", bonus: 3.0, items: [
    { id: "bullet_serve", name: "弾丸サーブ", desc: "サーブのスピードが別次元" },
    { id: "precision", name: "精密機械", desc: "狙ったコースに寸分違わず打ち込む" },
    { id: "ironman", name: "鉄人", desc: "フルセットでも動きが落ちない" },
    { id: "gods_touch", name: "神のタッチ", desc: "ドロップやボレーの感覚が別格" },
    { id: "idaten", name: "韋駄天", desc: "どんなボールにも追いつく" },
    { id: "champion", name: "王者の風格", desc: "大舞台ほど力を発揮する" }
  ] },
  plus: { label: "プラス能力", bonus: 1.0, items: [
    { id: "rising", name: "ライジング", desc: "バウンド直後を叩いて相手の時間を奪う" },
    { id: "high_point", name: "高い打点", desc: "高く弾む球も上から叩ける" },
    { id: "adversity", name: "逆境◯", desc: "追い込まれた場面で力を発揮する" },
    { id: "tenacious", name: "粘り強い", desc: "長いラリーでもミスをしない" },
    { id: "fast_start", name: "立ち上がり◯", desc: "試合の序盤から全開で入れる" },
    { id: "doubles", name: "ダブルス◯", desc: "ペアとの連携がうまい" }
  ] },
  minus: { label: "マイナス能力", bonus: -1.5, items: [
    { id: "double_fault", name: "ダブルフォールト癖", desc: "大事な場面でダブルフォールトしやすい" },
    { id: "slow_starter", name: "スロースターター", desc: "エンジンがかかるまで時間がかかる" },
    { id: "short_temper", name: "短気", desc: "判定やミスで崩れやすい" },
    { id: "quitter", name: "淡泊", desc: "劣勢になると粘らない" },
    { id: "streaky", name: "波がある", desc: "好不調の差が大きい" }
  ] },
  toggleGroups: ["gold", "plus", "minus"],
  chipOrder: [
    { group: "gold", chip: "gold" }, { group: "shotSkills", level: "great", chip: "great" },
    { group: "shotSkills", level: "good", chip: "good" }, { group: "plus", chip: "good" },
    { group: "rankSkills", chip: "rank" }, { group: "shotSkills", level: "bad", chip: "bad" },
    { group: "minus", chip: "bad" }
  ],
  exclusive: [["fast_start", "slow_starter"], ["tenacious", "quitter"]],
  score: {
    frontWeight: 0.7, backWeight: 0.3, scale: 40, min: 40,
    ranks: [
      { rank: "S", min: 3600 }, { rank: "A", min: 3200 }, { rank: "B", min: 2800 },
      { rank: "C", min: 2400 }, { rank: "D", min: 2000 }, { rank: "E", min: 1600 },
      { rank: "F", min: 800 }, { rank: "G", min: 0 }
    ]
  }
};

// file:// での画像出力用。支給SVGの内容を無変更で保持する。
DATA.iconSvg = {
  "assets/icons/serve-flat.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#B3202E\"/>\n  <polygon points=\"19.5,44 48,44 48,72 12,72\" fill=\"#FFFFFF\" fill-opacity=\"0.07\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.38\" stroke-width=\"1.5\" stroke-linejoin=\"round\">\n    <polygon points=\"26,20 70,20 84,72 12,72\"/>\n    <line x1=\"19.5\" y1=\"44\" x2=\"76.5\" y2=\"44\"/>\n    <line x1=\"48\" y1=\"44\" x2=\"48\" y2=\"72\"/>\n  </g>\n  <rect x=\"8\" y=\"66\" width=\"80\" height=\"7\" fill=\"#FFFFFF\" fill-opacity=\"0.10\"/>\n  <line x1=\"8\" y1=\"66\" x2=\"88\" y2=\"66\" stroke=\"#FFFFFF\" stroke-opacity=\"0.75\" stroke-width=\"2\"/>\n  <ellipse cx=\"42\" cy=\"52\" rx=\"4.5\" ry=\"1.8\" fill=\"#FFFFFF\" fill-opacity=\"0.75\"/>\n  <path d=\"M60 92 L42 52 L34 34\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <g stroke=\"#D7F34A\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-opacity=\"0.85\">\n    <line x1=\"42\" y1=\"38\" x2=\"46.5\" y2=\"48\"/>\n    <line x1=\"30.5\" y1=\"42\" x2=\"35\" y2=\"52\"/>\n    <line x1=\"46\" y1=\"29\" x2=\"49\" y2=\"36\"/>\n  </g>\n  <circle cx=\"33\" cy=\"32\" r=\"5\" fill=\"#D7F34A\"/>\n  <path d=\"M29.8 28.6 q2.6 3.4 0 6.8 M36.2 28.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n</svg>\n",
  "assets/icons/serve-kick.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#17734A\"/>\n  <polygon points=\"19.5,44 48,44 48,72 12,72\" fill=\"#FFFFFF\" fill-opacity=\"0.07\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.38\" stroke-width=\"1.5\" stroke-linejoin=\"round\">\n    <polygon points=\"26,20 70,20 84,72 12,72\"/>\n    <line x1=\"19.5\" y1=\"44\" x2=\"76.5\" y2=\"44\"/>\n    <line x1=\"48\" y1=\"44\" x2=\"48\" y2=\"72\"/>\n  </g>\n  <rect x=\"8\" y=\"66\" width=\"80\" height=\"7\" fill=\"#FFFFFF\" fill-opacity=\"0.10\"/>\n  <line x1=\"8\" y1=\"66\" x2=\"88\" y2=\"66\" stroke=\"#FFFFFF\" stroke-opacity=\"0.75\" stroke-width=\"2\"/>\n  <ellipse cx=\"38\" cy=\"54\" rx=\"4.5\" ry=\"1.8\" fill=\"#FFFFFF\" fill-opacity=\"0.75\"/>\n  <line x1=\"38\" y1=\"54\" x2=\"33\" y2=\"30\" stroke=\"#FFFFFF\" stroke-opacity=\"0.45\" stroke-width=\"1.5\" stroke-dasharray=\"2 3\"/>\n  <line x1=\"33\" y1=\"30\" x2=\"33\" y2=\"25\" stroke=\"#FFFFFF\" stroke-opacity=\"0.45\" stroke-width=\"1.5\" stroke-dasharray=\"2 3\"/>\n  <path d=\"M60 92 Q57 62 38 54\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M38 54 Q37 12 33 20\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M46 36 l4 -5 l4 5 M46 43 l4 -5 l4 5\" fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.8\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <circle cx=\"33\" cy=\"20\" r=\"5\" fill=\"#D7F34A\"/>\n  <path d=\"M29.8 16.6 q2.6 3.4 0 6.8 M36.2 16.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n</svg>\n",
  "assets/icons/serve-slice.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#1E4FA3\"/>\n  <polygon points=\"19.5,44 48,44 48,72 12,72\" fill=\"#FFFFFF\" fill-opacity=\"0.07\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.38\" stroke-width=\"1.5\" stroke-linejoin=\"round\">\n    <polygon points=\"26,20 70,20 84,72 12,72\"/>\n    <line x1=\"19.5\" y1=\"44\" x2=\"76.5\" y2=\"44\"/>\n    <line x1=\"48\" y1=\"44\" x2=\"48\" y2=\"72\"/>\n  </g>\n  <rect x=\"8\" y=\"66\" width=\"80\" height=\"7\" fill=\"#FFFFFF\" fill-opacity=\"0.10\"/>\n  <line x1=\"8\" y1=\"66\" x2=\"88\" y2=\"66\" stroke=\"#FFFFFF\" stroke-opacity=\"0.75\" stroke-width=\"2\"/>\n  <ellipse cx=\"22\" cy=\"58\" rx=\"4.5\" ry=\"1.8\" fill=\"#FFFFFF\" fill-opacity=\"0.75\"/>\n  <path d=\"M60 92 Q56 62 22 58\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M22 58 Q15 55 12 46\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"0.1 6\"/>\n  <circle cx=\"12\" cy=\"42\" r=\"5\" fill=\"#D7F34A\"/>\n  <path d=\"M8.8 38.6 q2.6 3.4 0 6.8 M15.2 38.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n</svg>\n",
  "assets/icons/serve-twist.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#6234B0\"/>\n  <polygon points=\"19.5,44 48,44 48,72 12,72\" fill=\"#FFFFFF\" fill-opacity=\"0.07\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.38\" stroke-width=\"1.5\" stroke-linejoin=\"round\">\n    <polygon points=\"26,20 70,20 84,72 12,72\"/>\n    <line x1=\"19.5\" y1=\"44\" x2=\"76.5\" y2=\"44\"/>\n    <line x1=\"48\" y1=\"44\" x2=\"48\" y2=\"72\"/>\n  </g>\n  <rect x=\"8\" y=\"66\" width=\"80\" height=\"7\" fill=\"#FFFFFF\" fill-opacity=\"0.10\"/>\n  <line x1=\"8\" y1=\"66\" x2=\"88\" y2=\"66\" stroke=\"#FFFFFF\" stroke-opacity=\"0.75\" stroke-width=\"2\"/>\n  <ellipse cx=\"28\" cy=\"56\" rx=\"4.5\" ry=\"1.8\" fill=\"#FFFFFF\" fill-opacity=\"0.75\"/>\n  <path d=\"M60 92 Q40 70 28 56\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M28 56 Q30 40 52 33\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <g stroke=\"#FFFFFF\" stroke-opacity=\"0.8\" stroke-width=\"1.6\" stroke-linecap=\"round\">\n    <line x1=\"22\" y1=\"50\" x2=\"19\" y2=\"47\"/>\n    <line x1=\"21\" y1=\"57\" x2=\"17\" y2=\"58\"/>\n    <line x1=\"25\" y1=\"63\" x2=\"23\" y2=\"66\"/>\n  </g>\n  <circle cx=\"55\" cy=\"32\" r=\"5\" fill=\"#D7F34A\"/>\n  <path d=\"M51.8 28.6 q2.6 3.4 0 6.8 M58.2 28.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n</svg>\n",
  "assets/icons/serve-under.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#B8620E\"/>\n  <polygon points=\"19.5,44 48,44 48,72 12,72\" fill=\"#FFFFFF\" fill-opacity=\"0.07\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.38\" stroke-width=\"1.5\" stroke-linejoin=\"round\">\n    <polygon points=\"26,20 70,20 84,72 12,72\"/>\n    <line x1=\"19.5\" y1=\"44\" x2=\"76.5\" y2=\"44\"/>\n    <line x1=\"48\" y1=\"44\" x2=\"48\" y2=\"72\"/>\n  </g>\n  <rect x=\"8\" y=\"66\" width=\"80\" height=\"7\" fill=\"#FFFFFF\" fill-opacity=\"0.10\"/>\n  <line x1=\"8\" y1=\"66\" x2=\"88\" y2=\"66\" stroke=\"#FFFFFF\" stroke-opacity=\"0.75\" stroke-width=\"2\"/>\n  <g transform=\"rotate(-35 66 80)\">\n    <ellipse cx=\"66\" cy=\"80\" rx=\"5.5\" ry=\"7.5\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"2\"/>\n    <line x1=\"66\" y1=\"87.5\" x2=\"66\" y2=\"93\" stroke=\"#FFFFFF\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  </g>\n  <ellipse cx=\"40\" cy=\"61\" rx=\"4.5\" ry=\"1.8\" fill=\"#FFFFFF\" fill-opacity=\"0.75\"/>\n  <path d=\"M61 76 Q50 44 40 61\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M40 61 Q36 51 32 56\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <circle cx=\"31\" cy=\"55\" r=\"5\" fill=\"#D7F34A\"/>\n  <path d=\"M27.8 51.6 q2.6 3.4 0 6.8 M34.2 51.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n</svg>\n",
  "assets/icons/style-aggressive.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#B3202E\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.30\" stroke-width=\"1.5\">\n    <rect x=\"24\" y=\"10\" width=\"48\" height=\"76\"/>\n    <line x1=\"24\" y1=\"29\" x2=\"72\" y2=\"29\"/>\n    <line x1=\"24\" y1=\"67\" x2=\"72\" y2=\"67\"/>\n    <line x1=\"48\" y1=\"29\" x2=\"48\" y2=\"67\"/>\n  </g>\n  <line x1=\"18\" y1=\"48\" x2=\"78\" y2=\"48\" stroke=\"#FFFFFF\" stroke-opacity=\"0.7\" stroke-width=\"2\"/>\n  <line x1=\"43\" y1=\"72\" x2=\"59.5\" y2=\"27\" stroke=\"#D7F34A\" stroke-width=\"5\" stroke-linecap=\"round\"/>\n  <polygon points=\"63,17 66.4,31.8 52.6,26.8\" fill=\"#D7F34A\" stroke=\"#D7F34A\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>\n  <g stroke=\"#FFFFFF\" stroke-width=\"2\" stroke-linecap=\"round\">\n    <line x1=\"68\" y1=\"12\" x2=\"72\" y2=\"8\"/>\n    <line x1=\"70.5\" y1=\"18\" x2=\"76\" y2=\"17.5\"/>\n    <line x1=\"61\" y1=\"10.5\" x2=\"60\" y2=\"5.5\"/>\n  </g>\n  <circle cx=\"40\" cy=\"79\" r=\"6\" fill=\"#FFFFFF\" stroke=\"#14213D\" stroke-opacity=\"0.55\" stroke-width=\"2\"/>\n  <circle cx=\"40\" cy=\"79\" r=\"2.4\" fill=\"#14213D\"/>\n</svg>\n",
  "assets/icons/style-allround.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#B8620E\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.30\" stroke-width=\"1.5\">\n    <rect x=\"24\" y=\"10\" width=\"48\" height=\"76\"/>\n    <line x1=\"24\" y1=\"29\" x2=\"72\" y2=\"29\"/>\n    <line x1=\"24\" y1=\"67\" x2=\"72\" y2=\"67\"/>\n    <line x1=\"48\" y1=\"29\" x2=\"48\" y2=\"67\"/>\n  </g>\n  <line x1=\"18\" y1=\"48\" x2=\"78\" y2=\"48\" stroke=\"#FFFFFF\" stroke-opacity=\"0.7\" stroke-width=\"2\"/>\n  <circle cx=\"48\" cy=\"48\" r=\"20\" fill=\"#D7F34A\" fill-opacity=\"0.12\" stroke=\"#D7F34A\" stroke-width=\"2.4\"/>\n  <g fill=\"#D7F34A\">\n    <polygon points=\"48,21 43.5,28 52.5,28\"/>\n    <polygon points=\"48,75 43.5,68 52.5,68\"/>\n    <polygon points=\"21,48 28,43.5 28,52.5\"/>\n    <polygon points=\"75,48 68,43.5 68,52.5\"/>\n  </g>\n  <circle cx=\"48\" cy=\"48\" r=\"6\" fill=\"#FFFFFF\" stroke=\"#14213D\" stroke-opacity=\"0.55\" stroke-width=\"2\"/>\n  <circle cx=\"48\" cy=\"48\" r=\"2.4\" fill=\"#14213D\"/>\n</svg>\n",
  "assets/icons/style-defensive.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#1E4FA3\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.30\" stroke-width=\"1.5\">\n    <rect x=\"24\" y=\"10\" width=\"48\" height=\"76\"/>\n    <line x1=\"24\" y1=\"29\" x2=\"72\" y2=\"29\"/>\n    <line x1=\"24\" y1=\"67\" x2=\"72\" y2=\"67\"/>\n    <line x1=\"48\" y1=\"29\" x2=\"48\" y2=\"67\"/>\n  </g>\n  <line x1=\"18\" y1=\"48\" x2=\"78\" y2=\"48\" stroke=\"#FFFFFF\" stroke-opacity=\"0.7\" stroke-width=\"2\"/>\n  <path d=\"M39 56 Q26 26 33 16\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"4 4\"/>\n  <path d=\"M57 56 Q70 26 63 16\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"4 4\"/>\n  <path d=\"M48 52 L61 57 L61 66.5 C61 74 55.5 79 48 82 C40.5 79 35 74 35 66.5 L35 57 Z\" fill=\"#D6EBFF\" stroke=\"#FFFFFF\" stroke-width=\"2\" stroke-linejoin=\"round\"/>\n  <path d=\"M48 58 L48 76 M41 64.5 L55 64.5\" stroke=\"#14213D\" stroke-opacity=\"0.35\" stroke-width=\"2\" stroke-linecap=\"round\"/>\n  <circle cx=\"48\" cy=\"89\" r=\"6\" fill=\"#FFFFFF\" stroke=\"#14213D\" stroke-opacity=\"0.55\" stroke-width=\"2\"/>\n  <circle cx=\"48\" cy=\"89\" r=\"2.4\" fill=\"#14213D\"/>\n</svg>\n",
  "assets/icons/style-serve-volley.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#17734A\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.30\" stroke-width=\"1.5\">\n    <rect x=\"24\" y=\"10\" width=\"48\" height=\"76\"/>\n    <line x1=\"24\" y1=\"29\" x2=\"72\" y2=\"29\"/>\n    <line x1=\"24\" y1=\"67\" x2=\"72\" y2=\"67\"/>\n    <line x1=\"48\" y1=\"29\" x2=\"48\" y2=\"67\"/>\n  </g>\n  <line x1=\"18\" y1=\"48\" x2=\"78\" y2=\"48\" stroke=\"#FFFFFF\" stroke-opacity=\"0.7\" stroke-width=\"2\"/>\n  <path d=\"M60 86 Q58 72 52 63.5\" fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.85\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-dasharray=\"3 4\"/>\n  <polygon points=\"48.6,59.8 56,62.2 50.4,67\" fill=\"#FFFFFF\" fill-opacity=\"0.85\"/>\n  <line x1=\"38\" y1=\"42\" x2=\"32\" y2=\"24.5\" stroke=\"#D7F34A\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n  <polygon points=\"29.5,17 35.6,23.6 27.9,26.2\" fill=\"#D7F34A\"/>\n  <circle cx=\"39\" cy=\"45\" r=\"4.5\" fill=\"#D7F34A\"/>\n  <path d=\"M35.8 41.6 q2.6 3.4 0 6.8 M42.2 41.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n  <circle cx=\"47\" cy=\"55\" r=\"6\" fill=\"#FFFFFF\" stroke=\"#14213D\" stroke-opacity=\"0.55\" stroke-width=\"2\"/>\n  <circle cx=\"47\" cy=\"55\" r=\"2.4\" fill=\"#14213D\"/>\n</svg>\n",
  "assets/icons/style-trickster.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\" width=\"96\" height=\"96\">\n  <rect width=\"96\" height=\"96\" rx=\"20\" fill=\"#6234B0\"/>\n  <g fill=\"none\" stroke=\"#FFFFFF\" stroke-opacity=\"0.30\" stroke-width=\"1.5\">\n    <rect x=\"24\" y=\"10\" width=\"48\" height=\"76\"/>\n    <line x1=\"24\" y1=\"29\" x2=\"72\" y2=\"29\"/>\n    <line x1=\"24\" y1=\"67\" x2=\"72\" y2=\"67\"/>\n    <line x1=\"48\" y1=\"29\" x2=\"48\" y2=\"67\"/>\n  </g>\n  <line x1=\"18\" y1=\"48\" x2=\"78\" y2=\"48\" stroke=\"#FFFFFF\" stroke-opacity=\"0.7\" stroke-width=\"2\"/>\n  <path d=\"M45 74 Q40 46 35 41\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <ellipse cx=\"35\" cy=\"41\" rx=\"3.5\" ry=\"1.6\" fill=\"#FFFFFF\" fill-opacity=\"0.8\"/>\n  <path d=\"M35 41 q-2 -5 -5 -2\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <path d=\"M51 74 Q76 42 59 17\" fill=\"none\" stroke=\"#D7F34A\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"4 4\"/>\n  <circle cx=\"59\" cy=\"16\" r=\"4.5\" fill=\"#D7F34A\"/>\n  <path d=\"M55.8 12.6 q2.6 3.4 0 6.8 M62.2 12.6 q-2.6 3.4 0 6.8\" fill=\"none\" stroke=\"#14213D\" stroke-opacity=\"0.45\" stroke-width=\"1\"/>\n  <path d=\"M72 56 l1.6 4.4 l4.4 1.6 l-4.4 1.6 l-1.6 4.4 l-1.6 -4.4 l-4.4 -1.6 l4.4 -1.6 z\" fill=\"#FFFFFF\"/>\n  <circle cx=\"48\" cy=\"80\" r=\"6\" fill=\"#FFFFFF\" stroke=\"#14213D\" stroke-opacity=\"0.55\" stroke-width=\"2\"/>\n  <circle cx=\"48\" cy=\"80\" r=\"2.4\" fill=\"#14213D\"/>\n</svg>\n"
};
