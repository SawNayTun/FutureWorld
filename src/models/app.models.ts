

export interface Agent { 
  name: string; 
  commission: number; 
}

export interface UpperBookie { 
  name: string; 
  commission: number; 
}

export interface BetDetail { 
  id: string; // Unique identifier for each bet entry
  amount: number; 
  source: string; 
  historyEntryId: string; // Link back to the original HistoryEntry
  number?: string; // Added to support explicit number storage
}

export interface GridCell { 
  number: string; 
  amount: number; 
  isOverLimit: boolean; 
  hasCustomLimit: boolean; // New property
  breakdown: BetDetail[]; 
  betsString: string;
  betsTooltip: string;
  overLimitAmount: number;
  limit: number;
}

export interface LimitGroup {
  id: string;
  name: string; // The input string (e.g., "apu", "12r", "00 01")
  amount: number;
  numbers: string[]; // The expanded numbers belonging to this group
  isOpen?: boolean; // For UI toggle state
}

export interface VoucherSettings {
  headerText: string;
  footerText: string;
  fontSize: 'small' | 'medium' | 'large';
  showDateTime: boolean;
}

export interface Report {
  id: string; // Unique key: report_YYYY-MM-DD_mode_session_type
  lotteryType: '2D' | '3D';
  date: string; // ISO date string of save time
  session?: 'morning' | 'evening'; // Optional for 2D
  drawDate?: string; // Optional for 3D
  mode: string; // 'အလယ်ဒိုင်' | 'ဒိုင်ကြီး' | 'အေးဂျင့်'
  
  // Financial Snapshot
  totalBetAmount: number;
  totalOverLimitAmount: number;
  totalHeldAmount: number;
  payableCommissionAmount: number;
  receivableCommissionAmount: number;
  agentCommissionEarned: number;
  netAmount: number;

  // Data Snapshot
  lotteryData: [string, number][]; // Serializable Map
  betHistory: string[]; // Raw entries
  
  // Settings Snapshot
  bookieName: string;
  defaultLimit: number;
  payoutRate: number;
  commissionToPay: number;
  agentCommissionFromBookie: number;
  commissionFromUpperBookie: number;
  individualLimits: [string, number][]; // Serializable Map
  upperBookies: UpperBookie[];
  agents: Agent[];
  currencySymbol: string;
}