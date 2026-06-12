export type UserRole = 'parent' | 'child';
export type AllowanceInterval = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface Allowance {
  id: string;
  name: string;                // e.g. "Base pocket money", "Room cleaning allowance"
  amount: number;              // e.g. 5.50
  interval: AllowanceInterval; // daily, weekly, biweekly, monthly
  lastCreditTimestamp: number; // UTC timestamp of when it was last credited
}

export interface UserProfile {
  uid: string;                 // Matches firebase auth uid
  name: string;                // Display name
  email?: string;              // Email (only for parents / Google logins)
  role: UserRole;
  parentIds: string[];         // List of parent uids linked to this child (empty for parents)
  allowances: Allowance[];     // List of allowance configurations for this child (empty for parents)
  currency: string;            // e.g. 'EUR', 'CHF', 'USD' (child specific)
  balance: number;             // Current calculated balance
  giroBalance?: number;        // Checking account balance (updated by parents only)
  username?: string;           // Username for child account custom login
  twelveDataApiKey?: string;   // Optional API key for stock price queries
  theme?: string;              // Stored neon theme preference
  unlockedAchievements?: string[]; // List of unlocked achievement IDs
}

export type TransactionType = 'allowance' | 'expense' | 'manual' | 'investment';

export interface Transaction {
  id: string;
  userId: string;              // Target child uid
  amount: number;              // Positive for allowance/manual bonus, negative for expenses/investments, positive for payouts
  type: TransactionType;
  category: string;            // 'Toys', 'Sweets', 'Allowance', 'Anlage', etc.
  description: string;         // e.g. "Weekly pocket money" or "Kinder Surprise egg"
  date: number;                // UTC timestamp
  createdBy?: 'parent' | 'child'; // Tracks who created the transaction to manage edit permissions
  giroDelta?: number;          // Change in Girokonto balance
  giroBalanceAfter?: number;   // Girokonto balance after this transaction
}

export interface InvestmentOffer {
  id: string;
  parentId: string;            // Parent who created it
  name: string;                // e.g. "Junior Festzins 6M" or "MSCI World ETF"
  type: 'festgeld' | 'aktienfonds';
  currency: string;            // Matches child currency
  
  // Festgeld specific:
  interestRate?: number;      // Annual interest rate (e.g. 0.05 for 5% p.a.)
  durationMonths?: number;    // Term duration in months
  
  // Aktienfonds specific:
  tickerSymbol?: string;      // Ticker symbol (e.g. "URTH", "QQQ")
  categoryName?: string;      // e.g. "Technologie", "Rohstoffe", "Weltweit"
  description?: string;       // Kid-friendly explanation
}

export interface Investment {
  id: string;
  userId: string;             // Child UID who holds the investment
  offerId: string;            // Reference to the offer
  name: string;
  type: 'festgeld' | 'aktienfonds';
  currency: string;
  amountInvested: number;     // Cash amount invested
  startDate: number;          // UTC timestamp of investment
  status: 'active' | 'completed' | 'sold';
  
  // Festgeld specific:
  interestRate?: number;
  durationMonths?: number;
  endDate?: number;           // Maturity timestamp
  amountMatured?: number;     // Principal + calculated interest (payout amount)
  
  // Aktienfonds specific:
  tickerSymbol?: string;
  categoryName?: string;
  buyPrice?: number;          // Ticker price when bought
  sharesOwned?: number;       // Calculated: amountInvested / buyPrice
  sellPrice?: number;         // Ticker price when sold
  sellDate?: number;          // UTC timestamp when sold
  amountSold?: number;        // Final payout: sharesOwned * sellPrice
}
