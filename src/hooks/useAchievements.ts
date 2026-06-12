import { useMemo, useState } from 'react';
import type { UserProfile, Transaction, Investment } from '../types';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: 'savings' | 'investment' | 'discipline' | 'chores';
  icon: string; // Emoji
  gradient: string; // CSS linear-gradient
  glowColor: string; // Glowing shadow color
  unlocked: boolean;
  progress: number;
  currentValue: string;
  targetValue: string;
}

export const useAchievements = (
  child: UserProfile | null,
  transactions: Transaction[],
  investments: Investment[],
  prices: Record<string, number> = {}
): Achievement[] => {
  const [now] = useState(() => Date.now());

  return useMemo(() => {
    if (!child) return [];

    // 1. CALCULATE CURRENT TOTAL WEALTH
    const freiesGuthaben = child.balance || 0;
    const activeInvs = investments.filter(i => i.status === 'active');
    const investmentsValue = activeInvs.reduce((sum, inv) => {
      const isFestgeld = inv.type === 'festgeld';
      const currentPrice = isFestgeld ? 0 : (prices[inv.tickerSymbol || ''] || inv.buyPrice || 1);
      const val = isFestgeld ? inv.amountInvested : (inv.sharesOwned || 0) * currentPrice;
      return sum + val;
    }, 0);
    const giroBalance = child.giroBalance || 0;
    const totalWealth = freiesGuthaben + investmentsValue + giroBalance;

    // 2. CALCULATE BEST INVESTMENT PERCENTAGE RETURN
    let maxReturnPercent = 0;
    const stockInvs = investments.filter(i => i.type === 'aktienfonds');
    stockInvs.forEach(inv => {
      if (inv.status === 'active') {
        const currentPrice = prices[inv.tickerSymbol || ''] || inv.buyPrice || 1;
        if (inv.buyPrice && inv.buyPrice > 0) {
          const ret = (currentPrice - inv.buyPrice) / inv.buyPrice;
          if (ret > maxReturnPercent) maxReturnPercent = ret;
        }
      } else if (inv.status === 'sold' && inv.amountSold && inv.amountInvested > 0) {
        const ret = (inv.amountSold - inv.amountInvested) / inv.amountInvested;
        if (ret > maxReturnPercent) maxReturnPercent = ret;
      }
    });
    const maxReturnFormatted = maxReturnPercent * 100;

    // 3. CALCULATE LONGEST GAP WITHOUT EXPENSES (STREAK)
    const expenses = transactions
      .filter(t => t.type === 'expense')
      .sort((a, b) => a.date - b.date);

    let maxStreakDays = 0;
    if (expenses.length === 0) {
      // If no expenses, count the duration since the earliest transaction in history, or fallback to 0.
      const earliestTx = transactions.reduce((min, t) => (t.date < min ? t.date : min), now);
      const daysSinceStart = Math.floor((now - earliestTx) / (24 * 60 * 60 * 1000));
      maxStreakDays = Math.max(0, daysSinceStart);
    } else {
      // Calculate gaps between consecutive expenses
      for (let i = 0; i < expenses.length; i++) {
        const prevTime = i === 0 
          ? transactions.reduce((min, t) => (t.date < min ? t.date : min), expenses[0].date)
          : expenses[i - 1].date;
        const gapDays = Math.floor((expenses[i].date - prevTime) / (24 * 60 * 60 * 1000));
        if (gapDays > maxStreakDays) maxStreakDays = gapDays;
      }
      // Also check the gap since the last expense to today
      const gapSinceLastExpense = Math.floor((now - expenses[expenses.length - 1].date) / (24 * 60 * 60 * 1000));
      if (gapSinceLastExpense > maxStreakDays) maxStreakDays = gapSinceLastExpense;
    }

    // 4. COUNT COMPLETED CHORES (Parent rewards)
    const choreCount = transactions.filter(
      t => t.type === 'manual' && t.amount > 0 && t.category === 'Belohnung'
    ).length;

    // 5. CHECK FESTGELD MATURITY COUNT
    const maturedFestgeldCount = investments.filter(
      i => i.type === 'festgeld' && i.status === 'completed'
    ).length;

    // Calculate total stock fund amount invested
    const stockActiveInvs = investments.filter(i => i.status === 'active' && i.type === 'aktienfonds');
    const totalStockInvested = stockActiveInvs.reduce((sum, i) => sum + i.amountInvested, 0);

    // Calculate total interest/payout profits earned from sold/matured investments
    const totalInterestEarned = investments.reduce((sum, inv) => {
      if (inv.status === 'completed' && inv.amountMatured) {
        return sum + Math.max(0, inv.amountMatured - inv.amountInvested);
      }
      if (inv.status === 'sold' && inv.amountSold) {
        return sum + Math.max(0, inv.amountSold - inv.amountInvested);
      }
      return sum;
    }, 0);

    // Check if child has logged at least one custom expense
    const hasExpense = expenses.length > 0;

    // 6. BUILD ACHIEVEMENTS ARRAY
    const currency = child.currency === 'EUR' ? '€' : child.currency;
    const list: Achievement[] = [
      {
        id: 'savings_first',
        title: 'Spargroschen 🪙',
        description: `Erreiche ein Gesamtvermögen von 10 ${currency}`,
        category: 'savings',
        icon: '🪙',
        gradient: 'linear-gradient(135deg, #a1887f, #8d6e63)',
        glowColor: 'rgba(141, 110, 99, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('savings_first') || totalWealth >= 10,
        progress: child.unlockedAchievements?.includes('savings_first') ? 100 : Math.min(100, Math.round((totalWealth / 10) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `10 ${currency}`
      },
      {
        id: 'savings_50',
        title: 'Sparfuchs-Bronze 🦊',
        description: `Erreiche ein Gesamtvermögen von 50 ${currency}`,
        category: 'savings',
        icon: '🦊',
        gradient: 'linear-gradient(135deg, #cd7f32, #a0522d)', // Bronze look
        glowColor: 'rgba(205, 127, 50, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('savings_50') || totalWealth >= 50,
        progress: child.unlockedAchievements?.includes('savings_50') ? 100 : Math.min(100, Math.round((totalWealth / 50) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `50 ${currency}`
      },
      {
        id: 'savings_150',
        title: 'Sparfuchs-Silber 🥈',
        description: `Erreiche ein Gesamtvermögen von 150 ${currency}`,
        category: 'savings',
        icon: '🥈',
        gradient: 'linear-gradient(135deg, #c0c0c0, #7f8c8d)', // Silver look
        glowColor: 'rgba(192, 192, 192, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('savings_150') || totalWealth >= 150,
        progress: child.unlockedAchievements?.includes('savings_150') ? 100 : Math.min(100, Math.round((totalWealth / 150) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `150 ${currency}`
      },
      {
        id: 'savings_500',
        title: 'Sparfuchs-Gold 🥇',
        description: `Erreiche ein Gesamtvermögen von 500 ${currency}`,
        category: 'savings',
        icon: '🥇',
        gradient: 'linear-gradient(135deg, #f1c40f, #f39c12)', // Gold look
        glowColor: 'rgba(241, 196, 15, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('savings_500') || totalWealth >= 500,
        progress: child.unlockedAchievements?.includes('savings_500') ? 100 : Math.min(100, Math.round((totalWealth / 500) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `500 ${currency}`
      },
      {
        id: 'savings_1000',
        title: 'Spar-König/in 👑',
        description: `Erreiche ein Gesamtvermögen von 1000 ${currency}`,
        category: 'savings',
        icon: '👑',
        gradient: 'linear-gradient(135deg, #e0f7fa, #00e5ff)', // Cyan glow look
        glowColor: 'rgba(0, 229, 255, 0.5)',
        unlocked: !!child.unlockedAchievements?.includes('savings_1000') || totalWealth >= 1000,
        progress: child.unlockedAchievements?.includes('savings_1000') ? 100 : Math.min(100, Math.round((totalWealth / 1000) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `1000 ${currency}`
      },
      {
        id: 'savings_2000',
        title: 'Spar-Großmeister/in 💎',
        description: `Erreiche ein Gesamtvermögen von 2000 ${currency}`,
        category: 'savings',
        icon: '💎',
        gradient: 'linear-gradient(135deg, #e0f7fa, #80deea, #00acc1)', // Diamond glow look
        glowColor: 'rgba(0, 172, 193, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('savings_2000') || totalWealth >= 2000,
        progress: child.unlockedAchievements?.includes('savings_2000') ? 100 : Math.min(100, Math.round((totalWealth / 2000) * 100)),
        currentValue: `${totalWealth.toFixed(0)} ${currency}`,
        targetValue: `2000 ${currency}`
      },
      {
        id: 'invest_first',
        title: 'Erster Schritt 🚀',
        description: 'Tätige deine erste Geldanlage (Festgeld oder Aktienfonds)',
        category: 'investment',
        icon: '🚀',
        gradient: 'linear-gradient(135deg, #3498db, #9b59b6)', // Blue-purple neon
        glowColor: 'rgba(155, 89, 182, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_first') || investments.length > 0,
        progress: (child.unlockedAchievements?.includes('invest_first') || investments.length > 0) ? 100 : 0,
        currentValue: `${investments.length}`,
        targetValue: '1'
      },
      {
        id: 'invest_diversified',
        title: 'Risiko-Streuer 🧩',
        description: 'Besitze 3 verschiedene Geldanlagen gleichzeitig',
        category: 'investment',
        icon: '🧩',
        gradient: 'linear-gradient(135deg, #00cbff, #007bf5)',
        glowColor: 'rgba(0, 123, 245, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_diversified') || activeInvs.length >= 3,
        progress: child.unlockedAchievements?.includes('invest_diversified') ? 100 : Math.min(100, Math.round((activeInvs.length / 3) * 100)),
        currentValue: `${activeInvs.length}`,
        targetValue: '3'
      },
      {
        id: 'invest_shares_100',
        title: 'Fonds-Wal 🐳',
        description: `Investiere insgesamt über 100 ${currency} in Aktienfonds`,
        category: 'investment',
        icon: '🐳',
        gradient: 'linear-gradient(135deg, #1e3c72, #2a5298)',
        glowColor: 'rgba(42, 82, 152, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_shares_100') || totalStockInvested >= 100,
        progress: child.unlockedAchievements?.includes('invest_shares_100') ? 100 : Math.min(100, Math.round((totalStockInvested / 100) * 100)),
        currentValue: `${totalStockInvested.toFixed(0)} ${currency}`,
        targetValue: `100 ${currency}`
      },
      {
        id: 'invest_shares_500',
        title: 'Fonds-Imperator/in 🪐',
        description: `Investiere insgesamt über 500 ${currency} in Aktienfonds`,
        category: 'investment',
        icon: '🪐',
        gradient: 'linear-gradient(135deg, #f857a6, #ff5858)', // Hot pink to coral
        glowColor: 'rgba(255, 88, 88, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_shares_500') || totalStockInvested >= 500,
        progress: child.unlockedAchievements?.includes('invest_shares_500') ? 100 : Math.min(100, Math.round((totalStockInvested / 500) * 100)),
        currentValue: `${totalStockInvested.toFixed(0)} ${currency}`,
        targetValue: `500 ${currency}`
      },
      {
        id: 'invest_profit_10',
        title: 'Cleverer Anleger 📈',
        description: 'Erziele über 10% Gewinn mit einem Aktienfonds',
        category: 'investment',
        icon: '📈',
        gradient: 'linear-gradient(135deg, #2ecc71, #1abc9c)', // Emerald neon
        glowColor: 'rgba(46, 204, 113, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_profit_10') || maxReturnFormatted >= 10,
        progress: child.unlockedAchievements?.includes('invest_profit_10') ? 100 : Math.min(100, Math.round((maxReturnFormatted / 10) * 100)),
        currentValue: `${maxReturnFormatted.toFixed(1)}%`,
        targetValue: '10%'
      },
      {
        id: 'invest_profit_25',
        title: 'Bulle von Wall Street 🐂',
        description: 'Erziele über 25% Gewinn mit einem Aktienfonds',
        category: 'investment',
        icon: '🐂',
        gradient: 'linear-gradient(135deg, #e67e22, #d35400)', // Orange neon
        glowColor: 'rgba(230, 126, 34, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_profit_25') || maxReturnFormatted >= 25,
        progress: child.unlockedAchievements?.includes('invest_profit_25') ? 100 : Math.min(100, Math.round((maxReturnFormatted / 25) * 100)),
        currentValue: `${maxReturnFormatted.toFixed(1)}%`,
        targetValue: '25%'
      },
      {
        id: 'invest_matured',
        title: 'Geduld zahlt sich aus ⏳',
        description: 'Bringe eine Festgeldanlage erfolgreich zur Fälligkeit',
        category: 'investment',
        icon: '⏳',
        gradient: 'linear-gradient(135deg, #95a5a6, #34495e)', // Slate look
        glowColor: 'rgba(149, 165, 166, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_matured') || maturedFestgeldCount > 0,
        progress: (child.unlockedAchievements?.includes('invest_matured') || maturedFestgeldCount > 0) ? 100 : 0,
        currentValue: `${maturedFestgeldCount}`,
        targetValue: '1'
      },
      {
        id: 'invest_matured_3',
        title: 'Zinseszins-Profi ⌛',
        description: 'Bringe 3 Festgeldanlagen erfolgreich zur Fälligkeit',
        category: 'investment',
        icon: '⌛',
        gradient: 'linear-gradient(135deg, #757f9a, #d7dde8)',
        glowColor: 'rgba(117, 127, 154, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_matured_3') || maturedFestgeldCount >= 3,
        progress: child.unlockedAchievements?.includes('invest_matured_3') ? 100 : Math.min(100, Math.round((maturedFestgeldCount / 3) * 100)),
        currentValue: `${maturedFestgeldCount}`,
        targetValue: '3'
      },
      {
        id: 'invest_interest_earned',
        title: 'Rendite-Jäger/in 💸',
        description: `Verdiene insgesamt über 15 ${currency} durch Zinsen oder Verkäufe`,
        category: 'investment',
        icon: '💸',
        gradient: 'linear-gradient(135deg, #11998e, #38ef7d)', // green-teal gradient
        glowColor: 'rgba(56, 239, 125, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('invest_interest_earned') || totalInterestEarned >= 15,
        progress: child.unlockedAchievements?.includes('invest_interest_earned') ? 100 : Math.min(100, Math.round((totalInterestEarned / 15) * 100)),
        currentValue: `${totalInterestEarned.toFixed(2)} ${currency}`,
        targetValue: `15 ${currency}`
      },
      {
        id: 'expense_first',
        title: 'Finanz-Planer/in 📑',
        description: 'Trage deine erste eigene Ausgabe im Dashboard ein',
        category: 'discipline',
        icon: '📑',
        gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)',
        glowColor: 'rgba(0, 242, 254, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('expense_first') || hasExpense,
        progress: (child.unlockedAchievements?.includes('expense_first') || hasExpense) ? 100 : 0,
        currentValue: hasExpense ? '1' : '0',
        targetValue: '1'
      },
      {
        id: 'discipline_streak_7',
        title: 'Ausgaben-Pause 🛡️',
        description: 'Halte 7 Tage am Stück durch, ohne Geld auszugeben',
        category: 'discipline',
        icon: '🛡️',
        gradient: 'linear-gradient(135deg, #ff0055, #ff7700)', // Crimson to orange
        glowColor: 'rgba(255, 0, 85, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('discipline_streak_7') || maxStreakDays >= 7,
        progress: child.unlockedAchievements?.includes('discipline_streak_7') ? 100 : Math.min(100, Math.round((maxStreakDays / 7) * 100)),
        currentValue: `${maxStreakDays} Tage`,
        targetValue: '7 Tage'
      },
      {
        id: 'discipline_streak_14',
        title: 'Disziplin-Meister 💎',
        description: 'Halte 14 Tage am Stück durch, ohne Geld auszugeben',
        category: 'discipline',
        icon: '💎',
        gradient: 'linear-gradient(135deg, #8e44ad, #2c3e50)', // Deep purple/dark blue
        glowColor: 'rgba(142, 68, 173, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('discipline_streak_14') || maxStreakDays >= 14,
        progress: child.unlockedAchievements?.includes('discipline_streak_14') ? 100 : Math.min(100, Math.round((maxStreakDays / 14) * 100)),
        currentValue: `${maxStreakDays} Tage`,
        targetValue: '14 Tage'
      },
      {
        id: 'discipline_streak_30',
        title: 'Spar-Zen-Meister 🧘',
        description: 'Halte 30 Tage am Stück durch, ohne Geld auszugeben',
        category: 'discipline',
        icon: '🧘',
        gradient: 'linear-gradient(135deg, #00f2fe, #4facfe)',
        glowColor: 'rgba(79, 172, 254, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('discipline_streak_30') || maxStreakDays >= 30,
        progress: child.unlockedAchievements?.includes('discipline_streak_30') ? 100 : Math.min(100, Math.round((maxStreakDays / 30) * 100)),
        currentValue: `${maxStreakDays} Tage`,
        targetValue: '30 Tage'
      },
      {
        id: 'discipline_streak_50',
        title: 'Spar-Zen-Großmeister/in 🧘‍♂️',
        description: 'Halte 50 Tage am Stück durch, ohne Geld auszugeben',
        category: 'discipline',
        icon: '🧘‍♂️',
        gradient: 'linear-gradient(135deg, #30cfd0, #330867)',
        glowColor: 'rgba(48, 207, 208, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('discipline_streak_50') || maxStreakDays >= 50,
        progress: child.unlockedAchievements?.includes('discipline_streak_50') ? 100 : Math.min(100, Math.round((maxStreakDays / 50) * 100)),
        currentValue: `${maxStreakDays} Tage`,
        targetValue: '50 Tage'
      },
      {
        id: 'chores_5',
        title: 'Fleißiges Bienchen 🐝',
        description: 'Erledige 5 Aufgaben (Gutschriften der Kategorie "Belohnung")',
        category: 'chores',
        icon: '🐝',
        gradient: 'linear-gradient(135deg, #f39c12, #f1c40f)', // Golden yellow
        glowColor: 'rgba(243, 156, 18, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('chores_5') || choreCount >= 5,
        progress: child.unlockedAchievements?.includes('chores_5') ? 100 : Math.min(100, Math.round((choreCount / 5) * 100)),
        currentValue: `${choreCount}`,
        targetValue: '5'
      },
      {
        id: 'chores_10',
        title: 'Super-Helfer/in 🚀',
        description: 'Erledige 10 Aufgaben (Gutschriften der Kategorie "Belohnung")',
        category: 'chores',
        icon: '🚀',
        gradient: 'linear-gradient(135deg, #f39c12, #e74c3c)',
        glowColor: 'rgba(231, 76, 60, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('chores_10') || choreCount >= 10,
        progress: child.unlockedAchievements?.includes('chores_10') ? 100 : Math.min(100, Math.round((choreCount / 10) * 100)),
        currentValue: `${choreCount}`,
        targetValue: '10'
      },
      {
        id: 'chores_25',
        title: 'Super-Star-Helfer/in 🌟',
        description: 'Erledige 25 Aufgaben (Gutschriften der Kategorie "Belohnung")',
        category: 'chores',
        icon: '🌟',
        gradient: 'linear-gradient(135deg, #ffe259, #ffa751)',
        glowColor: 'rgba(255, 167, 81, 0.4)',
        unlocked: !!child.unlockedAchievements?.includes('chores_25') || choreCount >= 25,
        progress: child.unlockedAchievements?.includes('chores_25') ? 100 : Math.min(100, Math.round((choreCount / 25) * 100)),
        currentValue: `${choreCount}`,
        targetValue: '25'
      }
    ];

    return list;
  }, [child, transactions, investments, prices, now]);
};
