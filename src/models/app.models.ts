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
}

export interface GridCell { 
  number: string; 
  amount: number; 
  isOverLimit: boolean; 
  breakdown: BetDetail[]; 
  betsString: string;
  betsTooltip: string;
  overLimitAmount: number;
  limit: number;
}

export interface Report {
  id: string; // Unique key: report_YYYY-MM-DD_mode_session
  date: string; // ISO date string of save time
  session: 'morning' | 'evening';
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