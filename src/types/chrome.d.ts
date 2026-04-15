declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      [key: string]: unknown;
    }
  }

  namespace runtime {
    interface LastError {
      message?: string;
    }

    interface InstalledDetails {
      reason?: string;
      [key: string]: unknown;
    }

    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: number;
      url?: string;
      [key: string]: unknown;
    }
  }
}

declare var chrome: any;