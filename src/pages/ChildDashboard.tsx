import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTransactions } from '../hooks/useDb';
import { pocketMoneyService, fetchFundPrice } from '../services/pocketMoneyService';
import { PocketMoneyChart } from '../components/PocketMoneyChart';
import { Modal } from '../components/Modal';
import { GirokontoChart } from '../components/GirokontoChart';
import { ChildInvestmentsTab } from '../components/ChildInvestmentsTab';
import { ThemePicker } from '../components/ThemePicker';
import type { Transaction, InvestmentOffer, Investment } from '../types';
import { useAchievements } from '../hooks/useAchievements';
import type { Achievement } from '../hooks/useAchievements';
import {
  TrendingUp,
  History,
  PlusCircle,
  LogOut,
  Trash2,
  Edit2,
  Briefcase,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  CreditCard,
  Key
} from 'lucide-react';

const CATEGORIES = [
  { value: 'Süßigkeiten', label: 'Süßigkeiten', icon: '🍬' },
  { value: 'Spielzeug', label: 'Spielzeug', icon: '🧸' },
  { value: 'Spiele', label: 'Videospiele', icon: '🎮' },
  { value: 'Bücher', label: 'Bücher & Hefte', icon: '📚' },
  { value: 'Kleidung', label: 'Kleidung', icon: '👕' },
  { value: 'Sonstiges', label: 'Sonstiges', icon: '🌀' }
];

const CURRENCIES = [
  { code: 'EUR', symbol: '€' },
  { code: 'CHF', symbol: 'CHF' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' }
];

export const ChildDashboard: React.FC = () => {
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'investments' | 'achievements' | 'giro'>('overview');
  const { transactions, loading: loadingTxs } = useTransactions(user?.uid);

  // States for Investment Module Redesign
  const [offers, setOffers] = useState<InvestmentOffer[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [currentTime] = useState(() => Date.now());

  const updatePrice = (ticker: string, price: number) => {
    setPrices(prev => ({ ...prev, [ticker]: price }));
  };

  // Subscribe to Offers (from child's parent)
  useEffect(() => {
    if (!user || !user.parentIds || user.parentIds.length === 0) return;
    const parentId = user.parentIds[0];
    const unsubscribe = pocketMoneyService.subscribeToInvestmentOffers(parentId, (data) => {
      setOffers(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Subscribe to Child Investments
  useEffect(() => {
    if (!user) return;
    const unsubscribe = pocketMoneyService.subscribeToInvestments(user.uid, (data) => {
      setInvestments(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Collect unique stock tickers to fetch prices
  const uniqueTickers = useMemo(() => {
    const tickers = new Set<string>();
    offers.forEach(o => {
      if (o.type === 'aktienfonds' && o.tickerSymbol) {
        tickers.add(o.tickerSymbol);
      }
    });
    investments.forEach(i => {
      if (i.type === 'aktienfonds' && i.tickerSymbol && i.status === 'active') {
        tickers.add(i.tickerSymbol);
      }
    });
    return Array.from(tickers);
  }, [offers, investments]);

  // Fetch prices periodically
  useEffect(() => {
    if (uniqueTickers.length === 0) return;

    const fetchAllPrices = async () => {
      const updatedPrices: Record<string, number> = {};
      await Promise.all(
        uniqueTickers.map(async (ticker) => {
          const price = await fetchFundPrice(ticker, user?.twelveDataApiKey);
          updatedPrices[ticker] = price;
        })
      );
      setPrices(prev => ({ ...prev, ...updatedPrices }));
    };

    fetchAllPrices();
    const interval = setInterval(fetchAllPrices, 60000);
    return () => clearInterval(interval);
  }, [uniqueTickers, user?.twelveDataApiKey]);

  // Calculate total wealth and asset allocation
  const wealthStats = useMemo(() => {
    const freiesGuthaben = user?.balance || 0;
    const giroBalance = user?.giroBalance || 0;
    const activeInvs = investments.filter(inv => inv.status === 'active');

    let totalInvested = 0;
    let stockProfit = 0;
    const categoryTotals: Record<string, number> = {};

    activeInvs.forEach(inv => {
      const isFestgeld = inv.type === 'festgeld';
      const cat = isFestgeld ? 'Festgeld 🔒' : (inv.categoryName || 'Aktienfonds 📈');

      const currentPrice = isFestgeld ? 0 : (prices[inv.tickerSymbol || ''] || inv.buyPrice || 1);
      const val = isFestgeld
        ? inv.amountInvested
        : Number(((inv.sharesOwned || 0) * currentPrice).toFixed(2));

      totalInvested += val;
      categoryTotals[cat] = (categoryTotals[cat] || 0) + val;

      if (!isFestgeld) {
        stockProfit += (val - inv.amountInvested);
      }
    });

    const gesamtvermoegen = Number((freiesGuthaben + totalInvested + giroBalance).toFixed(2));
    const allocations: { name: string; amount: number; percent: number; isCash?: boolean; isGiro?: boolean; isInvest?: boolean }[] = [];

    if (gesamtvermoegen > 0) {
      allocations.push({
        name: 'Mein Portemonnaie',
        amount: freiesGuthaben,
        percent: Number(((freiesGuthaben / gesamtvermoegen) * 100).toFixed(1)),
        isCash: true
      });

      allocations.push({
        name: 'Girokonto',
        amount: giroBalance,
        percent: Number(((giroBalance / gesamtvermoegen) * 100).toFixed(1)),
        isGiro: true
      });

      Object.entries(categoryTotals).forEach(([cat, val]) => {
        allocations.push({
          name: cat,
          amount: val,
          percent: Number(((val / gesamtvermoegen) * 100).toFixed(1)),
          isInvest: true
        });
      });
    } else {
      allocations.push({
        name: 'Mein Portemonnaie',
        amount: 0,
        percent: 100,
        isCash: true
      });
    }

    allocations.sort((a, b) => b.percent - a.percent);

    return {
      freiesGuthaben,
      giroBalance,
      totalInvested: Number(totalInvested.toFixed(2)),
      gesamtvermoegen,
      allocations,
      activeInvs,
      stockProfit: Number(stockProfit.toFixed(2))
    };
  }, [user?.balance, user?.giroBalance, investments, prices]);

  // Achievements engine
  const achievements = useAchievements(user, transactions, investments, prices);
  const [newlyUnlockedBadge, setNewlyUnlockedBadge] = useState<Achievement | null>(null);

  useEffect(() => {
    if (!user || achievements.length === 0) return;
    const ackKey = `EPM_ACK_BADGES_${user.uid}`;
    let ackIds: string[] = [];
    try {
      const stored = localStorage.getItem(ackKey);
      if (stored) {
        ackIds = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Error reading acknowledged badges:', e);
    }

    // Find any badge that is unlocked but NOT acknowledged yet
    const newBadge = achievements.find(a => a.unlocked && !ackIds.includes(a.id));
    if (newBadge) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewlyUnlockedBadge(newBadge);
    }
  }, [achievements, user]);

  const handleAcknowledgeBadge = () => {
    if (!user || !newlyUnlockedBadge) return;
    const ackKey = `EPM_ACK_BADGES_${user.uid}`;
    try {
      const stored = localStorage.getItem(ackKey);
      const ackIds: string[] = stored ? JSON.parse(stored) : [];
      if (!ackIds.includes(newlyUnlockedBadge.id)) {
        ackIds.push(newlyUnlockedBadge.id);
        localStorage.setItem(ackKey, JSON.stringify(ackIds));
      }
    } catch (e) {
      console.warn('Error saving acknowledged badge:', e);
    }
    setNewlyUnlockedBadge(null);
  };

  // Synchronize newly unlocked achievements with the database profile
  useEffect(() => {
    if (!user || achievements.length === 0) return;

    const currentUnlockedIds = user.unlockedAchievements || [];
    const freshlyUnlockedIds = achievements
      .filter(a => a.unlocked && !currentUnlockedIds.includes(a.id))
      .map(a => a.id);

    if (freshlyUnlockedIds.length > 0) {
      const updatedUnlockedAchievements = [...currentUnlockedIds, ...freshlyUnlockedIds];
      pocketMoneyService.updateUserProfile(user.uid, {
        unlockedAchievements: updatedUnlockedAchievements
      }).then(() => {
        refreshUser();
      }).catch(err => {
        console.error('Error saving unlocked achievements:', err);
      });
    }
  }, [achievements, user, refreshUser]);

  // Form states - Add Expense
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Süßigkeiten');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Girokonto deposit states
  const [depositAmount, setDepositAmount] = useState('');
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);

  // PIN change states
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    if (!user) return;
    
    if (newPin.trim().length < 6) {
      setPinError('Die neue PIN muss mindestens 6 Zeichen lang sein.');
      return;
    }

    try {
      await pocketMoneyService.changeChildPin(user.uid, oldPin.trim(), newPin.trim());
      setPinSuccess('Deine PIN wurde erfolgreich geändert! 🎉');
      setOldPin('');
      setNewPin('');
      setTimeout(() => {
        setIsPinModalOpen(false);
        setPinSuccess(null);
      }, 2000);
    } catch (err: unknown) {
      console.error(err);
      setPinError(err instanceof Error ? err.message : 'Fehler beim Ändern der PIN.');
    }
  };

  const handleGiroDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepositError(null);
    setDepositSuccess(null);

    if (!user) return;
    const amountNum = parseFloat(depositAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      setDepositError('Bitte gib einen gültigen Betrag ein.');
      return;
    }
    if (amountNum > wealthStats.freiesGuthaben) {
      setDepositError('Du hast nicht genügend Geld in deinem Portemonnaie.');
      return;
    }

    try {
      await pocketMoneyService.depositToGiro(user.uid, amountNum);
      setDepositAmount('');
      setDepositSuccess('Geld erfolgreich eingezahlt! 🎉');
      setTimeout(() => setDepositSuccess(null), 3000);
    } catch (err: unknown) {
      console.error(err);
      setDepositError(err instanceof Error ? err.message : 'Fehler bei der Einzahlung.');
    }
  };

  // Edit form states
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const handleDeleteTransaction = async (txId: string) => {
    if (window.confirm('Möchtest du diese Ausgabe wirklich löschen?')) {
      try {
        await pocketMoneyService.deleteTransaction(txId);
        await refreshUser();
      } catch (err: unknown) {
        console.error('Error deleting transaction:', err);
      }
    }
  };

  const openEditModal = (tx: Transaction) => {
    setEditingTx(tx);
    setEditAmount(Math.abs(tx.amount).toString());
    setEditCategory(tx.category);
    setEditDescription(tx.description);
    setEditError(null);
  };

  const handleUpdateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    if (!editingTx || !user) return;

    const amountNum = parseFloat(editAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setEditError('Bitte gib einen gültigen Betrag ein.');
      return;
    }

    const selectedIcon = CATEGORIES.find(c => c.value === editCategory)?.icon || '🛍️';
    const newAmount = -amountNum; // expense is stored as negative number

    try {
      await pocketMoneyService.updateTransaction(
        editingTx.id,
        {
          amount: newAmount,
          category: editCategory,
          description: editDescription.trim() || `${selectedIcon} ${editCategory}`
        },
        editingTx.amount // old amount
      );
      setEditingTx(null);
      await refreshUser();
    } catch (err: unknown) {
      console.error(err);
      setEditError(err instanceof Error ? err.message : 'Fehler beim Aktualisieren der Ausgabe.');
    }
  };

  const getCurrencySymbol = (code: string) => {
    return CURRENCIES.find(c => c.code === code)?.symbol || code;
  };

  const symbol = user ? getCurrencySymbol(user.currency) : '€';

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!user) return;
    const amountNum = parseFloat(expenseAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Bitte gib einen gültigen Betrag ein.');
      return;
    }

    if (amountNum > user.balance) {
      if (!window.confirm('Achtung! Dieser Kauf übersteigt dein aktuelles Guthaben. Möchtest du ihn trotzdem eintragen?')) {
        return;
      }
    }

    try {
      const selectedIcon = CATEGORIES.find(c => c.value === expenseCategory)?.icon || '🛍️';

      await pocketMoneyService.addTransaction({
        userId: user.uid,
        amount: -amountNum,
        type: 'expense',
        category: expenseCategory,
        description: expenseDescription.trim() || `${selectedIcon} ${expenseCategory}`,
        date: Date.now(),
        createdBy: 'child'
      });

      // Clear fields
      setExpenseAmount('');
      setExpenseDescription('');
      setSuccessMsg('Ausgabe erfolgreich eingetragen!');

      // Update local state balance by refreshing user profile
      await refreshUser();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Eintragen der Ausgabe.');
    }
  };

  // Calculate projected balances for highlights (30, 60, 90 days)
  const projections = React.useMemo(() => {
    if (!user) return {
      d30: { cash: 0, investments: 0, total: 0 },
      d60: { cash: 0, investments: 0, total: 0 },
      d90: { cash: 0, investments: 0, total: 0 }
    };

    const ms30 = currentTime + 30 * 24 * 60 * 60 * 1000;
    const ms60 = currentTime + 60 * 24 * 60 * 60 * 1000;
    const ms90 = currentTime + 90 * 24 * 60 * 60 * 1000;

    const daysList = [30, 60, 90];
    const msList = [ms30, ms60, ms90];

    const INTERVAL_MS = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      biweekly: 14 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const results = daysList.map((days, idx) => {
      const targetMs = msList[idx];
      let cashVal = user.balance;
      let invVal = 0;

      // 1. Add allowance payouts to cash
      if (user.allowances && user.allowances.length > 0) {
        user.allowances.forEach(allowance => {
          const intervalMs = INTERVAL_MS[allowance.interval];
          let nextTime = (allowance.lastCreditTimestamp || currentTime) + intervalMs;
          while (nextTime <= targetMs) {
            cashVal += allowance.amount;
            nextTime += intervalMs;
          }
        });
      }

      // 2. Process investments at targetMs
      if (investments && investments.length > 0) {
        investments.forEach(inv => {
          if (inv.status !== 'active') return;

          if (inv.type === 'festgeld') {
            // Festgeld maturation
            if (inv.endDate && inv.amountMatured) {
              if (inv.endDate <= targetMs) {
                // Matured, added to cash
                cashVal += inv.amountMatured;
              } else {
                // Still active investment
                invVal += inv.amountMatured;
              }
            }
          } else if (inv.type === 'aktienfonds') {
            // Aktienfonds forecast based on historical growth
            const currentPrice = prices[inv.tickerSymbol || ''] || inv.buyPrice || 1;
            const shares = inv.sharesOwned || 0;

            // Calculate elapsed days historically since purchase
            const elapsedMs = currentTime - inv.startDate;
            const elapsedDays = Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));

            let rDaily = 0.00021; // Default rate ~ 8% p.a.
            if (elapsedDays >= 1 && inv.buyPrice && inv.buyPrice > 0) {
              const historicalReturn = (currentPrice - inv.buyPrice) / inv.buyPrice;
              const calculatedRate = Math.pow(1 + historicalReturn, 1 / elapsedDays) - 1;

              // Clamp daily rate to avoid crazy projections from short-term volatility
              // Minimum: -0.0005 (approx -15% p.a.), Maximum: 0.0008 (approx +25% p.a.)
              rDaily = Math.max(-0.0005, Math.min(0.0008, calculatedRate));
            }

            // Project value at targetMs (days in future)
            const projectedPrice = currentPrice * Math.pow(1 + rDaily, days);
            invVal += Number((shares * projectedPrice).toFixed(2));
          }
        });
      }

      return {
        cash: Number(cashVal.toFixed(2)),
        investments: Number(invVal.toFixed(2)),
        total: Number((cashVal + invVal).toFixed(2))
      };
    });

    return {
      d30: results[0],
      d60: results[1],
      d90: results[2]
    };
  }, [user, currentTime, investments, prices]);

  if (!user) return null;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-group">
          <div className="logo-icon">€</div>
          <div>
            <h1 className="logo-text">Easy Pocket Money</h1>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 800 }}>Spardose</span>
          </div>
        </div>

        <ThemePicker compact />

        <div className="flex-align-center" style={{ gap: '0.75rem' }}>
          <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }} onClick={() => setIsPinModalOpen(true)}>
            <Key size={16} />
            <span>PIN ändern</span>
          </button>
          <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }} onClick={logout}>
            <LogOut size={16} />
            <span>Abmelden</span>
          </button>
        </div>
      </header>

      {/* Main content grid */}
      <main style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Tab Selection */}
        <div className="tabs-scroll-container">
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'overview' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'overview' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem',
              minWidth: '110px',
              flexShrink: 0
            }}
            onClick={() => setActiveTab('overview')}
          >
            Mein Sparbuch
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'giro' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'giro' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem',
              minWidth: '100px',
              flexShrink: 0
            }}
            onClick={() => setActiveTab('giro')}
          >
            Girokonto
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'investments' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'investments' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem',
              minWidth: '105px',
              flexShrink: 0
            }}
            onClick={() => setActiveTab('investments')}
          >
            Geldanlagen
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'transactions' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'transactions' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem',
              minWidth: '150px',
              flexShrink: 0
            }}
            onClick={() => setActiveTab('transactions')}
          >
            Ausgaben & Buchungen
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'achievements' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'achievements' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem',
              minWidth: '130px',
              flexShrink: 0
            }}
            onClick={() => setActiveTab('achievements')}
          >
            🏆 Meine Erfolge
          </button>
        </div>

        {activeTab === 'overview' && (
          <>
            {/* Row 1: Redesigned Wealth Summary Cards */}
            <div className="grid-4" style={{ gap: '1.5rem' }}>
              {/* Gesamtvermögen (Total Wealth) */}
              <div className="glass-panel p-2 text-center" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--bg-surface), var(--color-primary-glow))'
              }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Gesamtguthaben
                </span>
                <h2 style={{
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  margin: '0.5rem 0'
                }}>
                  {wealthStats.gesamtvermoegen.toFixed(2)} {symbol}
                </h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Erspartes + Girokonto
                </span>
              </div>

              {/* Freies Guthaben (Wallet Balance) */}
              <div className="glass-panel p-2 text-center" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Mein Portemonnaie
                </span>
                <h2 style={{
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--color-primary)',
                  margin: '0.5rem 0'
                }}>
                  {wealthStats.freiesGuthaben.toFixed(2)} {symbol}
                </h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Sofort bar ausgeben
                </span>
              </div>

              {/* Girokonto (Checking Account Balance) */}
              <div className="glass-panel p-2 text-center" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--bg-surface), var(--color-warning-bg))'
              }}>
                <span style={{ 
                  fontSize: '0.85rem', 
                  color: 'var(--text-secondary)', 
                  fontWeight: 600, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem'
                }}>
                  <CreditCard size={14} style={{ color: 'var(--color-warning)' }} />
                  <span>Mein Girokonto</span>
                </span>
                <h2 style={{
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--color-warning)',
                  margin: '0.5rem 0'
                }}>
                  {wealthStats.giroBalance.toFixed(2)} {symbol}
                </h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Von Eltern verwaltet
                </span>
              </div>

              {/* Angelegtes Geld (Invested Value) */}
              <div className="glass-panel p-2 text-center" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--bg-surface), var(--color-success-bg))'
              }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Meine Geldanlagen
                </span>
                <h2 style={{
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--color-success)',
                  margin: '0.5rem 0'
                }}>
                  {wealthStats.totalInvested.toFixed(2)} {symbol}
                </h2>
                <div className="flex-align-center" style={{ justifyContent: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                  {wealthStats.stockProfit >= 0 ? (
                    <span style={{ color: 'var(--color-success)', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                      <ArrowUpRight size={14} /> +{wealthStats.stockProfit.toFixed(2)} {symbol} Gewinn
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-danger)', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                      <ArrowDownRight size={14} /> {wealthStats.stockProfit.toFixed(2)} {symbol} Verlust
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: Asset Allocation Panel */}
            <div className="glass-panel p-2" style={{
              background: 'linear-gradient(to bottom, var(--bg-surface), rgba(255, 255, 255, 0.01))'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <PieChart size={18} className="text-primary" />
                <span>Meine Vermögensaufteilung</span>
              </h3>

              {/* Stacked Progress Bar */}
              <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'var(--border-color)', margin: '1rem 0' }}>
                {wealthStats.allocations.map((alloc, idx) => {
                  const colors = [
                    'var(--color-success)',   // Green
                    '#ff007f',                // Pink/Rose
                    '#7c3aed',                // Purple
                    '#f59e0b',                // Amber/Orange
                    '#10b981',                // Emerald
                    '#ef4444'                 // Red
                  ];
                  let color = colors[idx % colors.length];
                  if (alloc.isCash) {
                    color = 'var(--color-primary)';
                  } else if (alloc.isGiro) {
                    color = 'var(--color-warning)';
                  }

                  if (alloc.percent <= 0) return null;
                  return (
                    <div
                      key={alloc.name}
                      style={{
                        width: `${alloc.percent}%`,
                        background: color,
                        borderRight: '1px solid var(--bg-surface)',
                        transition: 'width 0.3s ease'
                      }}
                      title={`${alloc.name}: ${alloc.percent}%`}
                    />
                  );
                })}
              </div>

              {/* Legend Grid */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.75rem' }}>
                {wealthStats.allocations.map((alloc, idx) => {
                  const colors = [
                    'var(--color-success)',
                    '#ff007f',
                    '#7c3aed',
                    '#f59e0b',
                    '#10b981',
                    '#ef4444'
                  ];
                  let dotColor = colors[idx % colors.length];
                  if (alloc.isCash) {
                    dotColor = 'var(--color-primary)';
                  } else if (alloc.isGiro) {
                    dotColor = 'var(--color-warning)';
                  }

                  return (
                    <div key={alloc.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
                      <strong style={{ color: 'var(--text-primary)' }}>{alloc.percent}%</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>{alloc.name} ({alloc.amount.toFixed(2)} {symbol})</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 3: Zukunftsplaner & Aktive Geldanlagen */}
            <div className="grid-2" style={{ gap: '1.5rem' }}>

              {/* Projections Card */}
              <div className="glass-panel p-2" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <TrendingUp size={18} style={{ color: 'var(--color-success)' }} />
                    <span>Mein Spar-Zukunftsplaner</span>
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.3 }}>
                    Zukunftsprognose basierend auf Taschengeld & fälligen Festgeldanlagen:
                  </p>
                </div>

                <div className="projection-grid">
                  <div style={{ background: 'var(--border-color)', padding: '0.65rem 0.5rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>30 Tage</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-success)' }} title="Prognostiziertes Gesamtvermögen">{projections.d30.total.toFixed(2)} {symbol}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.62rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.2rem', gap: '0.1rem' }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Frei</span>
                        <span>{projections.d30.cash.toFixed(2)}{symbol}</span>
                      </span>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Anlage</span>
                        <span>{projections.d30.investments.toFixed(2)}{symbol}</span>
                      </span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--border-color)', padding: '0.65rem 0.5rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>60 Tage</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-success)' }} title="Prognostiziertes Gesamtvermögen">{projections.d60.total.toFixed(2)} {symbol}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.62rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.2rem', gap: '0.1rem' }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Frei</span>
                        <span>{projections.d60.cash.toFixed(2)}{symbol}</span>
                      </span>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Anlage</span>
                        <span>{projections.d60.investments.toFixed(2)}{symbol}</span>
                      </span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--border-color)', padding: '0.65rem 0.5rem', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>90 Tage</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-success)' }} title="Prognostiziertes Gesamtvermögen">{projections.d90.total.toFixed(2)} {symbol}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.62rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.2rem', gap: '0.1rem' }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Frei</span>
                        <span>{projections.d90.cash.toFixed(2)}{symbol}</span>
                      </span>
                      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Anlage</span>
                        <span>{projections.d90.investments.toFixed(2)}{symbol}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Investments Card */}
              <div className="glass-panel p-2" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Briefcase size={18} className="text-primary" />
                    <span>Meine aktiven Geldanlagen</span>
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.3 }}>
                    Deine laufenden Geldanlagen und deren aktuelle Gewinne oder Verluste:
                  </p>
                </div>

                {wealthStats.activeInvs.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '80px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    <p>Du hast aktuell keine aktiven Geldanlagen.</p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.4rem', fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '6px' }}
                      onClick={() => setActiveTab('investments')}
                    >
                      Jetzt anlegen 🚀
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '110px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {wealthStats.activeInvs.map(inv => {
                      const isFestgeld = inv.type === 'festgeld';
                      const end = inv.endDate || 0;
                      const days = Math.max(0, Math.ceil((end - currentTime) / (1000 * 60 * 60 * 24)));

                      const displayBadge = isFestgeld
                        ? `${inv.durationMonths}M`
                        : (inv.categoryName || 'Fonds');

                      const displaySub = isFestgeld
                        ? `${days === 0 ? 'Fällig' : `noch ${days} Tage`} | ${((inv.interestRate || 0) * 100).toFixed(1)}%`
                        : `${inv.tickerSymbol} | ${inv.sharesOwned?.toFixed(4)} Ant.`;

                      const currentPrice = isFestgeld ? 0 : (prices[inv.tickerSymbol || ''] || inv.buyPrice || 1);
                      const currentValue = isFestgeld
                        ? inv.amountInvested
                        : Number(((inv.sharesOwned || 0) * currentPrice).toFixed(2));

                      const profit = isFestgeld
                        ? 0
                        : Number((currentValue - inv.amountInvested).toFixed(2));

                      return (
                        <div
                          key={inv.id}
                          className="glass-panel flex-between"
                          style={{
                            background: 'rgba(255, 255, 255, 0.01)',
                            border: '1px solid rgba(255, 255, 255, 0.04)',
                            padding: '0.45rem 0.6rem',
                            borderRadius: '8px',
                            gap: '0.5rem'
                          }}
                        >
                          <div style={{ overflow: 'hidden' }}>
                            <div className="flex-align-center" style={{ gap: '0.35rem' }}>
                              <span className="badge" style={{
                                background: isFestgeld ? 'var(--color-primary-glow)' : 'var(--color-success-bg)',
                                color: isFestgeld ? 'var(--color-primary)' : 'var(--color-success)',
                                fontSize: '0.58rem',
                                padding: '1px 5px',
                                textTransform: 'none',
                                fontWeight: 800
                              }}>
                                {displayBadge}
                              </span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                {inv.name}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{displaySub}</span>
                          </div>

                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              {currentValue.toFixed(2)} {symbol}
                            </span>
                            {!isFestgeld && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                {profit >= 0 ? '+' : ''}{profit.toFixed(2)} {symbol}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Row 4: Chart */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
              <div style={{ gridColumn: 'span 1' }}>
                <PocketMoneyChart
                  child={user}
                  transactions={transactions}
                  currencySymbol={symbol}
                  investments={investments}
                  prices={prices}
                />
              </div>
            </div>

          </>
        )}

        {activeTab === 'achievements' && (
          <div className="glass-panel p-2">
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🏆</span>
              <span>Meine Erfolge & Abzeichen ({achievements.filter(a => a.unlocked).length} / {achievements.length})</span>
            </h3>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '1.25rem'
            }}>
              {achievements.map(badge => {
                return (
                  <div
                    key={badge.id}
                    className="glass-panel"
                    style={{
                      background: 'rgba(255, 255, 255, 0.01)',
                      border: badge.unlocked 
                        ? `1px solid ${badge.glowColor}` 
                        : '1px solid rgba(255, 255, 255, 0.03)',
                      padding: '1.25rem 1rem',
                      borderRadius: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      gap: '0.75rem',
                      opacity: badge.unlocked ? 1 : 0.45,
                      transition: 'all 0.3s ease',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: badge.unlocked ? `0 4px 15px -3px ${badge.glowColor}` : 'none'
                    }}
                  >
                    {/* Circular Badge Container */}
                    <div
                      style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: badge.gradient,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2rem',
                        boxShadow: `0 0 12px ${badge.glowColor}`,
                        position: 'relative'
                      }}
                    >
                      {badge.icon}
                      {!badge.unlocked && (
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(0, 0, 0, 0.6)',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem'
                        }}>
                          🔒
                        </div>
                      )}
                    </div>

                    {/* Title and Description */}
                    <div>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>
                        {badge.title}
                      </h4>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.3 }}>
                        {badge.description}
                      </p>
                    </div>

                    {/* Progress Details */}
                    <div style={{ width: '100%', marginTop: 'auto', paddingTop: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 600 }}>
                        <span>{badge.currentValue}</span>
                        <span>/ {badge.targetValue}</span>
                      </div>
                      <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '2.5px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${badge.progress}%`,
                          height: '100%',
                          background: badge.gradient,
                          borderRadius: '2.5px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}



        {activeTab === 'transactions' && (
          <div className="grid-2" style={{ gap: '2rem' }}>
            {/* Expense Form */}
            <div className="glass-panel p-2">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <PlusCircle size={18} style={{ color: 'var(--color-danger)' }} />
                <span>Ausgabe eintragen</span>
              </h3>

              {formError && (
                <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500 }}>
                  {formError}
                </div>
              )}

              {successMsg && (
                <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500 }}>
                  {successMsg}
                </div>
              )}

              <form onSubmit={handleAddExpense}>
                <div className="form-group">
                  <label className="form-label">Wie viel Geld hast du ausgegeben? ({symbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="form-input"
                    placeholder="0.00"
                    value={expenseAmount}
                    onChange={e => setExpenseAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Kategorie</label>
                  <select
                    className="form-select"
                    value={expenseCategory}
                    onChange={e => setExpenseCategory(e.target.value)}
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>
                        {cat.icon} {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Beschreibung (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="z.B. Kinokarte, Kaugummi"
                    value={expenseDescription}
                    onChange={e => setExpenseDescription(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Eintragen
                </button>
              </form>
            </div>

            {/* Transactions List */}
            <div className="glass-panel p-2" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <History size={18} className="text-primary" />
                <span>Letzte Buchungen</span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', flex: 1, maxHeight: '320px', paddingRight: '0.25rem' }}>
                {loadingTxs ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Buchungen werden geladen...</p>
                ) : transactions.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }}>
                    Noch keine Buchungen vorhanden.
                  </p>
                ) : (
                  transactions.map(tx => {
                    const isExpense = tx.amount < 0;
                    const displayDate = new Date(tx.date).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    });

                    return (
                      <div
                        key={tx.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingBottom: '0.75rem',
                          borderBottom: '1px solid var(--border-color)',
                          gap: '1rem'
                        }}
                      >
                        <div style={{ overflow: 'hidden' }}>
                          <div className="flex-align-center" style={{ gap: '0.5rem' }}>
                            <span style={{
                              fontSize: '0.85rem',
                              fontWeight: 700,
                              color: 'var(--text-primary)',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden'
                            }}>
                              {tx.description}
                            </span>
                            <span className="badge" style={{
                              background: tx.type === 'allowance'
                                ? 'var(--color-primary-glow)'
                                : tx.type === 'expense'
                                  ? 'var(--color-danger-bg)'
                                  : tx.type === 'investment'
                                    ? 'var(--color-success-bg)'
                                    : tx.category === 'Girokonto Einzahlung'
                                      ? 'var(--color-warning-bg)'
                                      : 'var(--border-color)',
                              color: tx.type === 'allowance'
                                ? 'var(--color-primary)'
                                : tx.type === 'expense'
                                  ? 'var(--color-danger)'
                                  : tx.type === 'investment'
                                    ? 'var(--color-success)'
                                    : tx.category === 'Girokonto Einzahlung'
                                      ? 'var(--color-warning)'
                                      : 'var(--text-secondary)',
                              fontSize: '0.6rem',
                              padding: '1px 6px'
                            }}>
                              {tx.type === 'allowance'
                                ? 'Taschengeld'
                                : tx.type === 'expense'
                                  ? 'Ausgabe'
                                  : tx.type === 'investment'
                                    ? 'Anlage'
                                    : tx.category === 'Girokonto Einzahlung'
                                      ? 'Umbuchung'
                                      : 'Gutschrift'}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {displayDate}
                          </span>
                        </div>

                        <div className="flex-align-center" style={{ flexShrink: 0 }}>
                          <span style={{
                            fontWeight: 800,
                            fontSize: '1rem',
                            color: isExpense ? 'var(--color-danger)' : 'var(--color-success)'
                          }}>
                            {isExpense ? '' : '+'}{tx.amount.toFixed(2)} {symbol}
                          </span>

                          {tx.createdBy === 'child' && tx.type !== 'investment' && tx.category !== 'Girokonto Einzahlung' && (
                            <div className="flex-align-center" style={{ gap: '0.35rem', marginLeft: '0.75rem' }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-icon-only"
                                style={{ width: '28px', height: '28px', padding: 0 }}
                                onClick={() => openEditModal(tx)}
                                title="Ausgabe bearbeiten"
                              >
                                <Edit2 size={12} style={{ color: 'var(--color-primary)' }} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-icon-only"
                                style={{ width: '28px', height: '28px', padding: 0 }}
                                onClick={() => handleDeleteTransaction(tx.id)}
                                title="Ausgabe löschen"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'investments' && (
          <ChildInvestmentsTab
            offers={offers}
            investments={investments}
            prices={prices}
            currentTime={currentTime}
            updatePrice={updatePrice}
          />
        )}

        {activeTab === 'giro' && user && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-warning)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CreditCard size={24} style={{ color: 'var(--color-warning)' }} />
              <span>Mein Girokonto</span>
            </h2>

            {/* Split layout: Form & Stats on left, Chart on right */}
            <div className="grid-2" style={{ gap: '1.5rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Stats panel */}
                <div className="glass-panel p-2" style={{
                  background: 'linear-gradient(135deg, var(--bg-surface), var(--color-warning-bg))'
                }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Aktuelles Girokonto-Guthaben</span>
                  <h3 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-warning)', margin: '0.5rem 0' }}>
                    {wealthStats.giroBalance.toFixed(2)} {symbol}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    Von deinen Eltern verwalteter Kontostand
                  </p>
                </div>

                {/* Inline Deposit Form */}
                <div className="glass-panel p-2">
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                    Taschengeld einzahlen
                  </h4>
                  
                  {depositError && (
                    <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.6rem', borderRadius: '8px', fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 500 }}>
                      {depositError}
                    </div>
                  )}
                  {depositSuccess && (
                    <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.6rem', borderRadius: '8px', fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 500 }}>
                      {depositSuccess}
                    </div>
                  )}

                  <form onSubmit={handleGiroDeposit}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      <span>Verfügbar im Portemonnaie:</span>
                      <strong style={{ color: 'var(--color-success)' }}>{wealthStats.freiesGuthaben.toFixed(2)} {symbol}</strong>
                    </div>

                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={wealthStats.freiesGuthaben}
                        className="form-input"
                        placeholder="Betrag in €"
                        value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)}
                        required
                        disabled={wealthStats.freiesGuthaben <= 0}
                      />
                    </div>

                    <button 
                      type="submit" 
                      className="btn btn-primary" 
                      style={{ 
                        width: '100%', 
                        background: 'var(--color-warning)', 
                        borderColor: 'var(--color-warning)', 
                        color: 'var(--bg-app)',
                        fontWeight: 700
                      }}
                      disabled={wealthStats.freiesGuthaben <= 0}
                    >
                      {wealthStats.freiesGuthaben <= 0 ? 'Kein Guthaben zum Einzahlen' : 'Jetzt einzahlen'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Chart Panel */}
              <div className="glass-panel p-2" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <GirokontoChart
                  child={user}
                  transactions={transactions}
                  currencySymbol={symbol}
                />
              </div>
            </div>

            {/* Split statistics */}
            <div className="grid-2" style={{ gap: '1rem' }}>
              <div className="glass-panel p-2 text-center">
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Selbst eingezahlt</span>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-success)', margin: '0.25rem 0' }}>
                  {(() => {
                    const selfDeposited = transactions
                      .filter(tx => tx.category === 'Girokonto Einzahlung')
                      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
                    return `${selfDeposited.toFixed(2)} ${symbol}`;
                  })()}
                </h3>
              </div>
              <div className="glass-panel p-2 text-center">
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Von Eltern angepasst</span>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)', margin: '0.25rem 0' }}>
                  {(() => {
                    const selfDeposited = transactions
                      .filter(tx => tx.category === 'Girokonto Einzahlung')
                      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
                    const parentAdjusted = (wealthStats.giroBalance || 0) - selfDeposited;
                    return `${parentAdjusted.toFixed(2)} ${symbol}`;
                  })()}
                </h3>
              </div>
            </div>

            {/* Girokonto specific transaction history */}
            <div className="glass-panel p-2">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={16} className="text-warning" style={{ color: 'var(--color-warning)' }} />
                <span>Girokonto Buchungen</span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                {transactions.filter(tx => tx.category === 'Girokonto Einzahlung' || tx.category === 'Girokonto Anpassung').length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', margin: '2rem 0' }}>
                    Noch keine Girokonto Buchungen vorhanden.
                  </p>
                ) : (
                  transactions
                    .filter(tx => tx.category === 'Girokonto Einzahlung' || tx.category === 'Girokonto Anpassung')
                    .map(tx => {
                      const isDeposit = tx.category === 'Girokonto Einzahlung';
                      const delta = tx.giroDelta ?? (isDeposit ? Math.abs(tx.amount) : 0);
                      const displayDate = new Date(tx.date).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      return (
                        <div
                          key={tx.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingBottom: '0.75rem',
                            borderBottom: '1px solid var(--border-color)',
                            gap: '1rem'
                          }}
                        >
                          <div>
                            <div className="flex-align-center" style={{ gap: '0.5rem' }}>
                              <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                {tx.description}
                              </strong>
                              <span className="badge" style={{
                                background: isDeposit ? 'var(--color-success-bg)' : 'var(--color-primary-bg)',
                                color: isDeposit ? 'var(--color-success)' : 'var(--color-primary)',
                                fontSize: '0.6rem',
                                padding: '1px 6px'
                              }}>
                                {isDeposit ? 'Einzahlung' : 'Eltern-Anpassung'}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {displayDate}
                            </span>
                          </div>

                          <div className="text-right">
                            <span style={{
                              fontWeight: 800,
                              fontSize: '0.95rem',
                              color: delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
                            }}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(2)} {symbol}
                            </span>
                            {tx.giroBalanceAfter !== undefined && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                Kontostand: {tx.giroBalanceAfter.toFixed(2)} {symbol}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Edit Expense Modal */}
      <Modal
        isOpen={editingTx !== null}
        onClose={() => setEditingTx(null)}
        title="Ausgabe bearbeiten"
      >
        <form onSubmit={handleUpdateExpense}>
          {editError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500 }}>
              {editError}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Betrag ({symbol})</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="form-input"
              placeholder="0.00"
              value={editAmount}
              onChange={e => setEditAmount(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Kategorie</label>
            <select
              className="form-select"
              value={editCategory}
              onChange={e => setEditCategory(e.target.value)}
            >
              {CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.icon} {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Beschreibung</label>
            <input
              type="text"
              className="form-input"
              placeholder="Was hast du dir gekauft?"
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Änderungen speichern
          </button>
        </form>
      </Modal>

      {/* Change PIN Modal */}
      <Modal
        isOpen={isPinModalOpen}
        onClose={() => {
          setIsPinModalOpen(false);
          setOldPin('');
          setNewPin('');
          setPinError(null);
          setPinSuccess(null);
        }}
        title="PIN-Code ändern 🔐"
      >
        <form onSubmit={handleUpdatePin}>
          {pinError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500 }}>
              {pinError}
            </div>
          )}
          {pinSuccess && (
            <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500 }}>
              {pinSuccess}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Alte PIN</label>
            <input
              type="password"
              className="form-input"
              placeholder="Deine aktuelle PIN"
              value={oldPin}
              onChange={e => setOldPin(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Neue PIN</label>
            <input
              type="password"
              className="form-input"
              placeholder="Deine neue PIN (mind. 6 Zeichen)"
              value={newPin}
              onChange={e => setNewPin(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            PIN speichern
          </button>
        </form>
      </Modal>

      {/* Achievement Unlocked Celebration Modal */}
      <Modal
        isOpen={newlyUnlockedBadge !== null}
        onClose={handleAcknowledgeBadge}
        title="🏆 Erfolg freigeschaltet!"
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '1rem 0',
          gap: '1.25rem',
          position: 'relative'
        }}>
          {/* Glowing Animated Badge */}
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: newlyUnlockedBadge?.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              boxShadow: `0 0 25px ${newlyUnlockedBadge?.glowColor}`,
              animation: 'unlockPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
            }}
          >
            {newlyUnlockedBadge?.icon}
          </div>

          <div>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
              {newlyUnlockedBadge?.title}
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Herzlichen Glückwunsch! Du hast dieses Abzeichen erfolgreich freigeschaltet:<br />
              <strong style={{ color: 'var(--color-success)' }}>{newlyUnlockedBadge?.description}</strong>
            </p>
          </div>

          <button 
            type="button" 
            className="btn btn-success" 
            style={{ width: '100%', padding: '0.75rem', fontWeight: 700, color: 'white', marginTop: '0.5rem' }} 
            onClick={handleAcknowledgeBadge}
          >
            Super! 🎉
          </button>

          {/* Simple CSS animation injected locally */}
          <style>{`
            @keyframes unlockPop {
              0% { transform: scale(0.3) rotate(-30deg); opacity: 0; }
              70% { transform: scale(1.1) rotate(10deg); }
              100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }
          `}</style>
        </div>
      </Modal>
    </div>
  );
};
