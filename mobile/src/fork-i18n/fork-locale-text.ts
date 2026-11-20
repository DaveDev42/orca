import type { SupportedUiLocale } from '../../../src/shared/i18n/ui-locale'

/**
 * Translations of the strings this fork adds, kept out of i18n/locales/*.json so a release that
 * adds keys next to ours never conflicts. English is the inline default at each call site.
 * A key the served catalog does carry wins over this table (see use-fork-translation.ts).
 */
export const FORK_LOCALE_TEXT: Partial<
  Record<SupportedUiLocale, Readonly<Record<string, string>>>
> = {
  de: {
    'hostScreen.keyCommands.openWorkspace': 'Workspace {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Workspaces durchsuchen',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Gestoppt, weil du still warst',
    'session.keyCommands.closeTab': 'Tab schließen',
    'session.keyCommands.selectTab': 'Tab {{n}}',
    'settings.voiceAutoStop.heading': 'WENN DU AUFHÖRST ZU SPRECHEN',
    'settings.voiceAutoStop.stopTitle': 'Stoppen, wenn ich still werde',
    'settings.voiceAutoStop.stopSubtitle':
      'Ein Diktat im Tippmodus endet nach etwa 1,6 Sekunden Stille von selbst.',
    'settings.voiceAutoStop.sendTitle': 'Nach dem Stoppen senden',
    'settings.voiceAutoStop.sendSubtitle':
      'Sendet die Nachricht, sobald das Diktat von selbst endete und der Text im Feld steht.'
  },
  es: {
    'hostScreen.keyCommands.openWorkspace': 'Espacio de trabajo {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Buscar espacios de trabajo',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Detenido al quedarte en silencio',
    'session.keyCommands.closeTab': 'Cerrar pestaña',
    'session.keyCommands.selectTab': 'Pestaña {{n}}',
    'settings.voiceAutoStop.heading': 'CUANDO DEJAS DE HABLAR',
    'settings.voiceAutoStop.stopTitle': 'Detener cuando me quede en silencio',
    'settings.voiceAutoStop.stopSubtitle':
      'Un dictado en modo toque termina solo tras unos 1,6 segundos de silencio.',
    'settings.voiceAutoStop.sendTitle': 'Enviar al detenerse',
    'settings.voiceAutoStop.sendSubtitle':
      'Envía el mensaje cuando el dictado terminó solo y su texto ya está en el cuadro.'
  },
  fr: {
    'hostScreen.keyCommands.openWorkspace': 'Espace de travail {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Rechercher des espaces de travail',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Arrêté, vous avez cessé de parler',
    'session.keyCommands.closeTab': "Fermer l'onglet",
    'session.keyCommands.selectTab': 'Onglet {{n}}',
    'settings.voiceAutoStop.heading': 'QUAND VOUS ARRÊTEZ DE PARLER',
    'settings.voiceAutoStop.stopTitle': 'Arrêter quand je me tais',
    'settings.voiceAutoStop.stopSubtitle':
      'Une dictée en mode toucher se termine d’elle-même après environ 1,6 seconde de silence.',
    'settings.voiceAutoStop.sendTitle': 'Envoyer après l’arrêt',
    'settings.voiceAutoStop.sendSubtitle':
      'Envoie le message quand la dictée s’est arrêtée d’elle-même et que son texte est dans le champ.'
  },
  ja: {
    'hostScreen.keyCommands.openWorkspace': 'ワークスペース {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'ワークスペースを検索',
    'session.useNativeChatDictation.stoppedAfterQuiet': '話が止まったため停止しました',
    'session.keyCommands.closeTab': 'タブを閉じる',
    'session.keyCommands.selectTab': 'タブ {{n}}',
    'settings.voiceAutoStop.heading': '話し終えたとき',
    'settings.voiceAutoStop.stopTitle': '静かになったら停止',
    'settings.voiceAutoStop.stopSubtitle':
      'タップモードの音声入力は、約1.6秒の無音で自動的に終了します。',
    'settings.voiceAutoStop.sendTitle': '停止後に送信',
    'settings.voiceAutoStop.sendSubtitle':
      '音声入力が自動で終了し、入力欄に文字が入ったらメッセージを送信します。'
  },
  ko: {
    'hostScreen.keyCommands.openWorkspace': '워크스페이스 {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': '워크스페이스 검색',
    'session.useNativeChatDictation.stoppedAfterQuiet': '말이 멈춰서 중지했습니다',
    'session.keyCommands.closeTab': '탭 닫기',
    'session.keyCommands.selectTab': '탭 {{n}}',
    'settings.voiceAutoStop.heading': '말을 멈췄을 때',
    'settings.voiceAutoStop.stopTitle': '조용해지면 중지',
    'settings.voiceAutoStop.stopSubtitle':
      '탭 모드 받아쓰기가 약 1.6초 동안 조용하면 스스로 끝납니다.',
    'settings.voiceAutoStop.sendTitle': '중지 후 바로 전송',
    'settings.voiceAutoStop.sendSubtitle':
      '받아쓰기가 스스로 끝나고 내용이 입력창에 들어가면 메시지를 보냅니다.'
  },
  pt: {
    'hostScreen.keyCommands.openWorkspace': 'Espaço de trabalho {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Pesquisar espaços de trabalho',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Parado porque você ficou em silêncio',
    'session.keyCommands.closeTab': 'Fechar aba',
    'session.keyCommands.selectTab': 'Aba {{n}}',
    'settings.voiceAutoStop.heading': 'QUANDO VOCÊ PARA DE FALAR',
    'settings.voiceAutoStop.stopTitle': 'Parar quando eu ficar em silêncio',
    'settings.voiceAutoStop.stopSubtitle':
      'Um ditado no modo toque termina sozinho após cerca de 1,6 segundo de silêncio.',
    'settings.voiceAutoStop.sendTitle': 'Enviar após parar',
    'settings.voiceAutoStop.sendSubtitle':
      'Envia a mensagem quando o ditado terminou sozinho e o texto já está na caixa.'
  },
  ru: {
    'hostScreen.keyCommands.openWorkspace': 'Рабочая область {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Поиск рабочих областей',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Остановлено: вы замолчали',
    'session.keyCommands.closeTab': 'Закрыть вкладку',
    'session.keyCommands.selectTab': 'Вкладка {{n}}',
    'settings.voiceAutoStop.heading': 'КОГДА ВЫ ПЕРЕСТАЁТЕ ГОВОРИТЬ',
    'settings.voiceAutoStop.stopTitle': 'Останавливать, когда я замолчу',
    'settings.voiceAutoStop.stopSubtitle':
      'Диктовка в режиме касания сама завершается примерно через 1,6 секунды тишины.',
    'settings.voiceAutoStop.sendTitle': 'Отправлять после остановки',
    'settings.voiceAutoStop.sendSubtitle':
      'Отправляет сообщение, когда диктовка завершилась сама и текст уже в поле.'
  },
  tr: {
    'hostScreen.keyCommands.openWorkspace': 'Çalışma alanı {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': 'Çalışma alanlarını ara',
    'session.useNativeChatDictation.stoppedAfterQuiet': 'Sustuğunuz için durduruldu',
    'session.keyCommands.closeTab': 'Sekmeyi kapat',
    'session.keyCommands.selectTab': 'Sekme {{n}}',
    'settings.voiceAutoStop.heading': 'KONUŞMAYI BIRAKTIĞINIZDA',
    'settings.voiceAutoStop.stopTitle': 'Sustuğumda durdur',
    'settings.voiceAutoStop.stopSubtitle':
      'Dokunma modundaki dikte yaklaşık 1,6 saniyelik sessizlikten sonra kendiliğinden biter.',
    'settings.voiceAutoStop.sendTitle': 'Durduktan sonra gönder',
    'settings.voiceAutoStop.sendSubtitle':
      'Dikte kendiliğinden bittiğinde ve metin kutuya girdiğinde mesajı gönderir.'
  },
  'zh-Hant': {
    'hostScreen.keyCommands.openWorkspace': '工作區 {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': '搜尋工作區',
    'session.useNativeChatDictation.stoppedAfterQuiet': '偵測到停止說話，已停止',
    'session.keyCommands.closeTab': '關閉分頁',
    'session.keyCommands.selectTab': '分頁 {{n}}',
    'settings.voiceAutoStop.heading': '說完話時',
    'settings.voiceAutoStop.stopTitle': '安靜後停止',
    'settings.voiceAutoStop.stopSubtitle': '點按模式的聽寫在約 1.6 秒無聲後會自動結束。',
    'settings.voiceAutoStop.sendTitle': '停止後傳送',
    'settings.voiceAutoStop.sendSubtitle': '聽寫自動結束且內容已進入輸入框後，傳送訊息。'
  },
  zh: {
    'hostScreen.keyCommands.openWorkspace': '工作区 {{n}}',
    'hostScreen.keyCommands.searchWorkspaces': '搜索工作区',
    'session.useNativeChatDictation.stoppedAfterQuiet': '检测到停止说话，已停止',
    'session.keyCommands.closeTab': '关闭标签页',
    'session.keyCommands.selectTab': '标签页 {{n}}',
    'settings.voiceAutoStop.heading': '说完话时',
    'settings.voiceAutoStop.stopTitle': '安静后停止',
    'settings.voiceAutoStop.stopSubtitle': '点按模式的听写在约 1.6 秒无声后会自动结束。',
    'settings.voiceAutoStop.sendTitle': '停止后发送',
    'settings.voiceAutoStop.sendSubtitle': '听写自动结束且内容已进入输入框后，发送消息。'
  }
}
