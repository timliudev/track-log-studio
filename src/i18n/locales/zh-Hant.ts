export default {
  app: {
    title: 'aRacer Loga Analysis',
    subtitle: 'aRacer ECU 記錄分析與 RaceChrono 轉檔',
  },
  footer: {
    developedBy: 'Developed by',
  },
  nav: {
    converter: '轉檔器',
    analyzer: '分析器',
    analyzerSoon: '（Phase 2）',
  },
  theme: {
    label: '主題',
    auto: '自動',
    light: '淺色',
    dark: '深色',
  },
  language: {
    label: '語言',
    auto: '自動',
  },
  converter: {
    notes: {
      racechrono: '轉換後的 .nmea 檔供 RaceChrono DIY 裝置匯入使用。',
      importGuide: '匯入說明',
      raceModule:
        '需安裝 aRacer Race Module 才有 GPS 數據可於底圖對位；若無 GPS，仍可轉出感測器數據（RC3），此時時間戳以轉檔當下時間合成。',
    },
    upload: {
      title: '載入 .loga 檔',
      hint: '點擊選擇或拖放檔案到這裡，可一次選多個',
      button: '選擇檔案',
    },
    files: {
      heading: '已載入檔案',
      empty: '尚未載入任何檔案',
      rows: '{n} 列',
      parsing: '解析中…',
      error: '錯誤',
      remove: '移除',
      clear: '全部清除',
    },
    preset: {
      heading: '欄位組合 (Preset)',
      current: '目前組合',
      default: '預設',
      custom: '自訂（未儲存）',
      userEmpty: '使用者 {n}（空）',
      saveTo: '儲存到',
      name: '名稱',
      save: '儲存',
      reset: '重設為預設',
    },
    mapping: {
      heading: 'RC3 欄位對應',
      fixedHeading: '固定欄位（自動填入）',
      accel: '加速度 xacc/yacc/zacc ← TC_Xforce/Yforce/Zforce ÷ 1000',
      gyro: '角速度 gyrox/y/z ← TC_Xangle_dps/Yangle_dps/Zangle_dps',
      gyroAbsent: '角速度 gyrox/y/z ← 此檔無，留空',
      rpm: 'rpm/d1 ← RPM',
      slot: '槽位',
      channel: 'loga 欄位',
      none: '（不使用）',
      search: '搜尋欄位…',
      pick: '選擇欄位',
      needFile: '請先載入檔案以選擇欄位',
    },
    convert: {
      button: '轉換',
      converting: '轉換中…',
      noReady: '沒有可轉換的檔案',
      resultsHeading: '轉換結果',
      downloadAll: '全部下載 (ZIP)',
      download: '下載',
    },
  },
}
