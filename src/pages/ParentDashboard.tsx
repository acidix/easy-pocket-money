import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChildren, useTransactions } from '../hooks/useDb';
import { pocketMoneyService, fetchFundPrice } from '../services/pocketMoneyService';
import type { UserProfile, Allowance, AllowanceInterval, Investment } from '../types';
import { Modal } from '../components/Modal';
import { ThemePicker } from '../components/ThemePicker';
import { InvestmentOffersTab } from '../components/InvestmentOffersTab';
import { useAchievements } from '../hooks/useAchievements';
import { 
  Plus, 
  Minus, 
  Trash2, 
  Settings, 
  History, 
  LogOut, 
  UserPlus, 
  DollarSign, 
  Users, 
  Clock,
  CreditCard,
  Share2
} from 'lucide-react';

const CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'CHF', symbol: 'CHF', label: 'Schweizer Franken (CHF)' },
  { code: 'USD', symbol: '$', label: 'US-Dollar ($)' },
  { code: 'GBP', symbol: '£', label: 'Britisches Pfund (£)' }
];

const INTERVAL_LABELS: Record<AllowanceInterval, string> = {
  daily: 'Täglich',
  weekly: 'Wöchentlich',
  biweekly: 'Alle 2 Wochen',
  monthly: 'Monatlich'
};

const getAvatarStyle = (name: string) => {
  const colors = [
    'linear-gradient(135deg, #7c3aed, #00f0ff)', // Purple to Cyan
    'linear-gradient(135deg, #ff007f, #ff7700)', // Pink to Orange
    'linear-gradient(135deg, #39ff14, #00ff66)', // Green to Lime
    'linear-gradient(135deg, #ffe600, #ff7700)', // Yellow to Orange
    'linear-gradient(135deg, #ff0055, #7c3aed)'  // Red to Purple
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradient = colors[hash % colors.length];
  return {
    background: gradient,
    color: '#ffffff',
    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
    boxShadow: '0 0 10px rgba(0, 0, 0, 0.2)'
  };
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

interface ChildCardProps {
  child: UserProfile;
  getCurrencySymbol: (code: string) => string;
  openModal: (modalName: 'createChild' | 'adjustBalance' | 'manageAllowances' | 'viewTransactions' | 'adjustGiro' | 'shareChild', child: UserProfile | null) => void;
  parentApiKey?: string;
}

const ChildCard: React.FC<ChildCardProps> = ({ child, getCurrencySymbol, openModal, parentApiKey }) => {
  const { transactions } = useTransactions(child.uid);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = pocketMoneyService.subscribeToInvestments(child.uid, (data) => {
      setInvestments(data);
    });
    return () => unsubscribe();
  }, [child.uid]);

  const uniqueTickers = useMemo(() => {
    const tickers = new Set<string>();
    investments.forEach(i => {
      if (i.type === 'aktienfonds' && i.tickerSymbol && i.status === 'active') {
        tickers.add(i.tickerSymbol);
      }
    });
    return Array.from(tickers);
  }, [investments]);

  useEffect(() => {
    if (uniqueTickers.length === 0) return;

    const fetchAllPrices = async () => {
      const updatedPrices: Record<string, number> = {};
      await Promise.all(
        uniqueTickers.map(async (ticker) => {
          const price = await fetchFundPrice(ticker, parentApiKey);
          updatedPrices[ticker] = price;
        })
      );
      setPrices(prev => ({ ...prev, ...updatedPrices }));
    };

    fetchAllPrices();
    const interval = setInterval(fetchAllPrices, 60000);
    return () => clearInterval(interval);
  }, [uniqueTickers, parentApiKey]);

  const achievements = useAchievements(child, transactions, investments, prices);
  const unlockedBadges = useMemo(() => achievements.filter(a => a.unlocked), [achievements]);

  const avatarStyle = getAvatarStyle(child.name);
  const initials = getInitials(child.name);
  const symbol = getCurrencySymbol(child.currency);
  const hasAllowances = child.allowances && child.allowances.length > 0;

  return (
    <div className="glass-panel p-2 flex-between" style={{ 
      flexDirection: 'column', 
      alignItems: 'stretch', 
      gap: '1.5rem',
      position: 'relative'
    }}>
      {/* Child Card Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="flex-between" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '0.9rem',
              ...avatarStyle
            }}>
              {initials}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{child.name}</h4>
                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                  @{child.username}
                </span>
              </div>
            </div>
          </div>
          
          <button 
            type="button" 
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.4rem',
              borderRadius: '50%',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
            onClick={() => openModal('shareChild', child)}
            title="Konto mit anderem Elternteil teilen"
          >
            <Share2 size={16} />
          </button>
        </div>
        
        {/* Balances Grid (Guaranteed No Wrap) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-color)',
            padding: '0.65rem 0.75rem',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem'
          }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              Taschengeld
            </span>
            <span style={{ 
              fontSize: '1.25rem', 
              fontWeight: 800, 
              color: child.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
              whiteSpace: 'nowrap'
            }}>
              {child.balance.toFixed(2)} {symbol}
            </span>
          </div>
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-color)',
            padding: '0.65rem 0.75rem',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem'
          }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              Girokonto
            </span>
            <span style={{ 
              fontSize: '1.25rem', 
              fontWeight: 800, 
              color: 'var(--color-primary)',
              whiteSpace: 'nowrap'
            }}>
              {(child.giroBalance || 0).toFixed(2)} {symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Allowances Summary */}
      <div style={{ 
        background: 'var(--border-color)', 
        padding: '0.75rem 1rem', 
        borderRadius: '12px',
        fontSize: '0.85rem'
      }}>
        <span style={{ fontWeight: 700, display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
          Taschengeld Raten:
        </span>
        {hasAllowances ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {child.allowances.map(allowance => (
              <div key={allowance.id} className="flex-between" style={{ fontWeight: 500 }}>
                <span className="flex-align-center" style={{ gap: '0.35rem' }}>
                  <Clock size={12} style={{ color: 'var(--color-primary)' }} />
                  {allowance.name}
                </span>
                <span style={{ fontWeight: 700 }}>
                  +{allowance.amount.toFixed(2)} {symbol} ({INTERVAL_LABELS[allowance.interval]})
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Kein regelmäßiges Taschengeld eingerichtet.</span>
        )}
      </div>

      {/* Quick Action Grid */}
      <div className="child-actions-grid">
        <button 
          type="button" 
          className="btn btn-secondary" 
          onClick={() => openModal('adjustBalance', child)}
          style={{ padding: '0.5rem', fontSize: '0.75rem', flexDirection: 'column', gap: '0.25rem' }}
        >
          <DollarSign size={16} style={{ color: 'var(--color-success)' }} />
          <span>Anpassen</span>
        </button>
        
        <button 
          type="button" 
          className="btn btn-secondary" 
          onClick={() => openModal('adjustGiro', child)}
          style={{ padding: '0.5rem', fontSize: '0.75rem', flexDirection: 'column', gap: '0.25rem' }}
        >
          <CreditCard size={16} style={{ color: 'var(--color-warning)' }} />
          <span>Girokonto</span>
        </button>
        
        <button 
          type="button" 
          className="btn btn-secondary" 
          onClick={() => openModal('manageAllowances', child)}
          style={{ padding: '0.5rem', fontSize: '0.75rem', flexDirection: 'column', gap: '0.25rem' }}
        >
          <Settings size={16} style={{ color: 'var(--color-primary)' }} />
          <span>Taschengeld</span>
        </button>

        <button 
          type="button" 
          className="btn btn-secondary" 
          onClick={() => openModal('viewTransactions', child)}
          style={{ padding: '0.5rem', fontSize: '0.75rem', flexDirection: 'column', gap: '0.25rem' }}
        >
          <History size={16} style={{ color: 'var(--text-primary)' }} />
          <span>Buchungen</span>
        </button>
      </div>

      {/* Achievements Summary */}
      <div style={{
        marginTop: '0.25rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Erfolge ({unlockedBadges.length}/{achievements.length}):
        </span>
        {unlockedBadges.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {unlockedBadges.map(badge => (
              <div
                key={badge.id}
                title={`${badge.title}: ${badge.description}`}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: badge.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.95rem',
                  boxShadow: `0 2px 8px ${badge.glowColor}`,
                  cursor: 'help',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {badge.icon}
              </div>
            ))}
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>
            Noch keine Abzeichen freigeschaltet.
          </span>
        )}
      </div>
    </div>
  );
};

export const ParentDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { children, loading } = useChildren(user?.uid);

  // Active Tab state
  const [activeTab, setActiveTab] = useState<'children' | 'investments'>('children');

  // Modal control states
  const [activeModal, setActiveModal] = useState<'createChild' | 'adjustBalance' | 'manageAllowances' | 'viewTransactions' | 'adjustGiro' | 'shareChild' | null>(null);
  const [selectedChild, setSelectedChild] = useState<UserProfile | null>(null);

  // Form states - Create Child
  const [childName, setChildName] = useState('');
  const [childUsername, setChildUsername] = useState('');
  const [childPin, setChildPin] = useState('');
  const [childCurrency, setChildCurrency] = useState('EUR');
  const [formError, setFormError] = useState<string | null>(null);

  // Form states - Adjust Balance
  const [adjustType, setAdjustType] = useState<'credit' | 'debit'>('credit');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustCategory, setAdjustCategory] = useState('Taschengeld');
  const [adjustDescription, setAdjustDescription] = useState('');

  // Form states - Adjust Girokonto
  const [giroAmount, setGiroAmount] = useState('');

  // Form states - Manage Allowances
  const [allowanceName, setAllowanceName] = useState('Basis-Taschengeld');
  const [allowanceAmount, setAllowanceAmount] = useState('');
  const [allowanceInterval, setAllowanceInterval] = useState<AllowanceInterval>('weekly');

  // Form states - Share Child
  const [shareEmail, setShareEmail] = useState('');
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);
  const [shareInvitePending, setShareInvitePending] = useState(false);

  // Load transactions of selected child for detail view
  const { transactions: childTransactions } = useTransactions(selectedChild?.uid);

  const getCurrencySymbol = (code: string) => {
    return CURRENCIES.find(c => c.code === code)?.symbol || code;
  };

  const openModal = (modalName: 'createChild' | 'adjustBalance' | 'manageAllowances' | 'viewTransactions' | 'adjustGiro' | 'shareChild', child: UserProfile | null) => {
    setSelectedChild(child);
    setFormError(null);
    setActiveModal(modalName);
    
    // Reset forms
    if (modalName === 'createChild') {
      setChildName('');
      setChildUsername('');
      setChildPin('');
      setChildCurrency('EUR');
    } else if (modalName === 'adjustBalance') {
      setAdjustType('credit');
      setAdjustAmount('');
      setAdjustCategory('Belohnung');
      setAdjustDescription('');
    } else if (modalName === 'manageAllowances') {
      setAllowanceName('Taschengeld');
      setAllowanceAmount('');
      setAllowanceInterval('weekly');
    } else if (modalName === 'adjustGiro') {
      setGiroAmount(child?.giroBalance?.toString() || '0');
    } else if (modalName === 'shareChild') {
      setShareEmail('');
      setShareSuccess(null);
      setShareInvitePending(false);
    }
  };

  const handleCreateChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!user) return;
    if (!childName.trim() || !childUsername.trim() || !childPin.trim()) {
      setFormError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }

    if (childPin.trim().length < 6) {
      setFormError('Der PIN muss mindestens 6 Zeichen oder Ziffern lang sein.');
      return;
    }

    try {
      await pocketMoneyService.createChild(
        childName,
        childUsername,
        childPin,
        user.uid,
        childCurrency
      );
      setActiveModal(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Kindes.');
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedChild) return;
    const amountNum = parseFloat(adjustAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Bitte gib einen gültigen Betrag ein.');
      return;
    }

    const transactionAmount = adjustType === 'credit' ? amountNum : -amountNum;

    try {
      await pocketMoneyService.addTransaction({
        userId: selectedChild.uid,
        amount: transactionAmount,
        type: 'manual',
        category: adjustCategory,
        description: adjustDescription.trim() || (adjustType === 'credit' ? 'Manuelle Gutschrift' : 'Manuelle Auszahlung'),
        date: Date.now(),
        createdBy: 'parent'
      });
      setActiveModal(null);
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Aktualisieren des Kontos.');
    }
  };

  const handleAdjustGiro = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedChild) return;
    const amountNum = parseFloat(giroAmount);

    if (isNaN(amountNum) || amountNum < 0) {
      setFormError('Bitte gib einen gültigen Betrag ein (mindestens 0).');
      return;
    }

    const oldGiro = selectedChild.giroBalance || 0;
    const delta = Number((amountNum - oldGiro).toFixed(2));

    try {
      // 1. Update user profile
      await pocketMoneyService.updateUserProfile(selectedChild.uid, {
        giroBalance: amountNum
      });

      // 2. Add transaction log for Girokonto change (if changed)
      if (delta !== 0) {
        await pocketMoneyService.addTransaction({
          userId: selectedChild.uid,
          amount: 0,
          type: 'manual',
          category: 'Girokonto Anpassung',
          description: delta > 0 
            ? `Einzahlung durch Eltern: +${delta.toFixed(2)} ${getCurrencySymbol(selectedChild.currency)}` 
            : `Auszahlung durch Eltern: ${delta.toFixed(2)} ${getCurrencySymbol(selectedChild.currency)}`,
          date: Date.now(),
          createdBy: 'parent',
          giroDelta: delta,
          giroBalanceAfter: amountNum
        });
      }

      setActiveModal(null);
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Aktualisieren des Girokontos.');
    }
  };

  const handleShareChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setShareSuccess(null);
    setShareInvitePending(false);

    if (!selectedChild) return;
    const emailClean = shareEmail.trim().toLowerCase();

    if (!emailClean) {
      setFormError('Bitte gib eine E-Mail-Adresse ein.');
      return;
    }

    try {
      const res = await pocketMoneyService.shareChildWithParent(selectedChild.uid, emailClean);
      if (res.status === 'pending') {
        setShareInvitePending(true);
        setShareSuccess(`Einladung für '${shareEmail.trim()}' vorgemerkt! Da diese E-Mail noch nicht registriert ist, kannst du nun unten eine Einladungs-E-Mail senden.`);
      } else {
        setShareSuccess(`Erfolgreich geteilt! '${shareEmail.trim()}' kann nun auf das Konto zugreifen.`);
        setShareEmail('');
        setTimeout(() => {
          setActiveModal(null);
          setShareSuccess(null);
        }, 3000);
      }
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Teilen des Kontos.');
    }
  };

  const handleAddAllowance = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedChild) return;
    const amountNum = parseFloat(allowanceAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Bitte gib einen gültigen Betrag ein.');
      return;
    }

    const newAllowance: Allowance = {
      id: Math.random().toString(36).substring(2, 9),
      name: allowanceName.trim() || 'Sparguthaben',
      amount: amountNum,
      interval: allowanceInterval,
      lastCreditTimestamp: Date.now() // start crediting from now
    };

    const currentAllowances = selectedChild.allowances || [];
    const updatedAllowances = [...currentAllowances, newAllowance];

    try {
      await pocketMoneyService.updateUserProfile(selectedChild.uid, {
        allowances: updatedAllowances
      });
      
      // Update selected child state in dashboard to show immediately in modal
      setSelectedChild({
        ...selectedChild,
        allowances: updatedAllowances
      });

      // Clear input
      setAllowanceAmount('');
      setAllowanceName('Bonus-Taschengeld');
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen des Taschengeldes.');
    }
  };

  const handleDeleteAllowance = async (allowanceId: string) => {
    if (!selectedChild) return;
    
    const updatedAllowances = selectedChild.allowances.filter(a => a.id !== allowanceId);
    
    try {
      await pocketMoneyService.updateUserProfile(selectedChild.uid, {
        allowances: updatedAllowances
      });
      setSelectedChild({
        ...selectedChild,
        allowances: updatedAllowances
      });
    } catch (err: unknown) {
      console.error('Error deleting allowance:', err);
    }
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (window.confirm('Möchtest du diese Transaktion wirklich löschen? Der Kontostand wird entsprechend angepasst.')) {
      try {
        await pocketMoneyService.deleteTransaction(txId);
      } catch (err: unknown) {
        console.error('Error deleting transaction:', err);
      }
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-group">
          <div className="logo-icon">€</div>
          <div>
            <h1 className="logo-text">Easy Pocket Money</h1>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Eltern-Bereich</span>
          </div>
        </div>
        
        <ThemePicker compact />
        
        <div className="flex-align-center" style={{ gap: '1.25rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{user?.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{user?.email}</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={logout}>
            <LogOut size={16} />
            <span>Abmelden</span>
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main>
        <div className="glass-panel p-2 welcome-card" style={{ marginBottom: '2.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Hallo, {user?.name.split(' ')[0]}! 👋</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Hier verwaltest du das Taschengeld, die Sparraten und die Geldanlagen deiner Kinder.
            </p>
          </div>
          
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={() => openModal('createChild', null)}
          >
            <UserPlus size={18} />
            <span>Kind hinzufügen</span>
          </button>
        </div>

        {/* Tab Selection */}
        <div className="parent-tabs-menu">
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'children' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'children' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.55rem',
              fontSize: '0.9rem'
            }}
            onClick={() => setActiveTab('children')}
          >
            Kinder
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
              fontSize: '0.9rem'
            }}
            onClick={() => setActiveTab('investments')}
          >
            Geldanlagen
          </button>
        </div>

        {activeTab === 'children' ? (
          <>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={20} style={{ color: 'var(--color-primary)' }} />
          <span>Registrierte Kinder</span>
        </h3>

        {loading ? (
          <div className="text-center p-2">
            <p style={{ color: 'var(--text-secondary)' }}>Lade Profile...</p>
          </div>
        ) : children.length === 0 ? (
          <div className="glass-panel p-2 text-center" style={{ padding: '3.5rem 2rem' }}>
            <Users size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>Bisher keine Kinder angelegt</h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
              Erstelle dein erstes Kinderprofil, um das Taschengeld zu planen und Ausgaben zu erfassen.
            </p>
            <button 
              type="button" 
              className="btn btn-primary"
              onClick={() => openModal('createChild', null)}
            >
              <UserPlus size={18} />
              <span>Erstes Kind anlegen</span>
            </button>
          </div>
        ) : (
          <div className="grid-2">
            {children.map(child => (
              <ChildCard
                key={child.uid}
                child={child}
                getCurrencySymbol={getCurrencySymbol}
                openModal={openModal}
                parentApiKey={user?.twelveDataApiKey}
              />
            ))}
          </div>
        )}
          </>
        ) : (
          <InvestmentOffersTab childrenList={children} />
        )}
      </main>

      {/* ==========================================
          MODALS
          ========================================== */}
      
      {/* 1. Create Child Modal */}
      <Modal 
        isOpen={activeModal === 'createChild'} 
        onClose={() => setActiveModal(null)}
        title="Neues Kind hinzufügen"
      >
        <form onSubmit={handleCreateChild} className="modal-form">
          {formError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {formError}
            </div>
          )}
          
          <div className="form-group">
            <label className="form-label">Name des Kindes</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="z.B. Luisa"
              value={childName}
              onChange={e => setChildName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Benutzername (für Kinder-Login)</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="z.B. luisa12"
              value={childUsername}
              onChange={e => setChildUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">PIN-Code (min. 6 Zeichen)</label>
            <input 
              type="password" 
              className="form-input" 
              placeholder="z.B. 123456"
              value={childPin}
              onChange={e => setChildPin(e.target.value)}
              required
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mit diesem Benutzername und PIN meldet sich das Kind an.</span>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Währung</label>
            <select 
              className="form-select"
              value={childCurrency}
              onChange={e => setChildCurrency(e.target.value)}
            >
              {CURRENCIES.map(curr => (
                <option key={curr.code} value={curr.code}>{curr.label}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Kind erstellen
          </button>
        </form>
      </Modal>

      {/* 2. Adjust Balance Modal */}
      <Modal 
        isOpen={activeModal === 'adjustBalance'} 
        onClose={() => setActiveModal(null)}
        title={`Kontostand anpassen: ${selectedChild?.name}`}
      >
        <form onSubmit={handleAdjustBalance}>
          {formError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', background: 'var(--border-color)', padding: '4px', borderRadius: '10px', marginBottom: '1.25rem' }}>
            <button
              type="button"
              className="btn"
              style={{
                flex: 1,
                background: adjustType === 'credit' ? 'var(--color-success-bg)' : 'transparent',
                color: adjustType === 'credit' ? 'var(--color-success)' : 'var(--text-secondary)',
                borderRadius: '8px',
                padding: '0.4rem'
              }}
              onClick={() => setAdjustType('credit')}
            >
              <Plus size={14} />
              <span>Gutschreiben (+)</span>
            </button>
            <button
              type="button"
              className="btn"
              style={{
                flex: 1,
                background: adjustType === 'debit' ? 'var(--color-danger-bg)' : 'transparent',
                color: adjustType === 'debit' ? 'var(--color-danger)' : 'var(--text-secondary)',
                borderRadius: '8px',
                padding: '0.4rem'
              }}
              onClick={() => setAdjustType('debit')}
            >
              <Minus size={14} />
              <span>Abziehen (-)</span>
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Betrag ({selectedChild ? getCurrencySymbol(selectedChild.currency) : ''})</label>
            <input 
              type="number" 
              step="0.01"
              min="0.01"
              className="form-input" 
              placeholder="0.00"
              value={adjustAmount}
              onChange={e => setAdjustAmount(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Kategorie</label>
            <select 
              className="form-select"
              value={adjustCategory}
              onChange={e => setAdjustCategory(e.target.value)}
            >
              {adjustType === 'credit' ? (
                <>
                  <option value="Belohnung">Belohnung (z.B. Hausarbeit)</option>
                  <option value="Geschenk">Geschenk (Geburtstag/Ostern)</option>
                  <option value="Taschengeld">Taschengeld Bonus</option>
                  <option value="Kontoanpassung">Kontoanpassung (Startguthaben / Korrektur)</option>
                  <option value="Sonstiges">Sonstiges</option>
                </>
              ) : (
                <>
                  <option value="Ausgabe">Ausgabe verbucht</option>
                  <option value="Strafgebühr">Strafgebühr</option>
                  <option value="Kontoanpassung">Kontoanpassung (Korrektur)</option>
                  <option value="Sonstiges">Sonstiges</option>
                </>
              )}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Beschreibung (optional)</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="z.B. Zimmer aufgeräumt oder Lego gekauft"
              value={adjustDescription}
              onChange={e => setAdjustDescription(e.target.value)}
            />
          </div>

          <button type="submit" className={`btn ${adjustType === 'credit' ? 'btn-success' : 'btn-danger'}`} style={{ width: '100%', color: 'white' }}>
            {adjustType === 'credit' ? 'Gutschrift buchen' : 'Abzug buchen'}
          </button>
        </form>
      </Modal>

      {/* 2.5. Adjust Girokonto Modal */}
      <Modal 
        isOpen={activeModal === 'adjustGiro'} 
        onClose={() => setActiveModal(null)}
        title={`Girokonto-Stand anpassen: ${selectedChild?.name}`}
      >
        <form onSubmit={handleAdjustGiro} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {formError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 500 }}>
              {formError}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Neuer Girokonto-Stand ({selectedChild ? getCurrencySymbol(selectedChild.currency) : ''})</label>
            <input 
              type="number" 
              step="0.01"
              className="form-input" 
              placeholder="0.00"
              value={giroAmount}
              onChange={e => setGiroAmount(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', color: 'white' }}>
            Kontostand speichern
          </button>
        </form>
      </Modal>

      {/* 3. Manage Allowances Modal */}
      <Modal 
        isOpen={activeModal === 'manageAllowances'} 
        onClose={() => setActiveModal(null)}
        title={`Taschengeld anpassen: ${selectedChild?.name}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Active Allowances List */}
          <div>
            <h4 className="form-label" style={{ marginBottom: '0.75rem' }}>Eingerichtetes Taschengeld (Raten)</h4>
            {selectedChild?.allowances && selectedChild.allowances.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {selectedChild.allowances.map(a => (
                  <div key={a.id} className="flex-between" style={{
                    background: 'var(--bg-primary)',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', display: 'block' }}>{a.name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Intervall: {INTERVAL_LABELS[a.interval]}</span>
                    </div>
                    
                    <div className="flex-align-center" style={{ gap: '1rem' }}>
                      <span style={{ fontWeight: 800, color: 'var(--color-success)', fontSize: '0.95rem' }}>
                        +{a.amount.toFixed(2)} {getCurrencySymbol(selectedChild.currency)}
                      </span>
                      <button 
                        type="button" 
                        className="btn btn-danger btn-icon-only" 
                        style={{ width: '32px', height: '32px' }}
                        onClick={() => handleDeleteAllowance(a.id)}
                        title="Dauerauftrag löschen"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                Keine Daueraufträge aktiv. Das Taschengeld muss manuell gebucht werden.
              </p>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />

          {/* Add New Allowance Form */}
          <form onSubmit={handleAddAllowance}>
            <h4 className="form-label" style={{ marginBottom: '0.75rem' }}>Neue Sparrate einrichten</h4>
            {formError && (
              <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {formError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Bezeichnung</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="z.B. Wöchentliches Taschengeld"
                value={allowanceName}
                onChange={e => setAllowanceName(e.target.value)}
                required
              />
            </div>

            <div className="grid-2" style={{ gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Betrag ({selectedChild ? getCurrencySymbol(selectedChild.currency) : ''})</label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0.01"
                  className="form-input" 
                  placeholder="0.00"
                  value={allowanceAmount}
                  onChange={e => setAllowanceAmount(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Intervall</label>
                <select 
                  className="form-select"
                  value={allowanceInterval}
                  onChange={e => setAllowanceInterval(e.target.value as AllowanceInterval)}
                >
                  <option value="daily">Täglich</option>
                  <option value="weekly">Wöchentlich</option>
                  <option value="biweekly">Alle 2 Wochen</option>
                  <option value="monthly">Monatlich</option>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
              Dauerauftrag aktivieren
            </button>
          </form>
        </div>
      </Modal>

      {/* 4. View Transactions Modal */}
      <Modal 
        isOpen={activeModal === 'viewTransactions'} 
        onClose={() => setActiveModal(null)}
        title={`Transaktionshistorie: ${selectedChild?.name}`}
      >
        <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
          {childTransactions.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '2rem' }}>
              Bisher keine Transaktionen aufgezeichnet.
            </p>
          ) : (
            childTransactions.map(tx => {
              const isExpense = tx.amount < 0;
              const dateStr = new Date(tx.date).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
              const symbol = selectedChild ? getCurrencySymbol(selectedChild.currency) : '';

              return (
                <div key={tx.id} className="flex-between" style={{
                  background: 'var(--bg-primary)',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  gap: '1rem'
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.15rem' }}>
                      <span className={`badge ${isExpense ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}>
                        {tx.category}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{dateStr}</span>
                    </div>
                    <p style={{ 
                      fontSize: '0.9rem', 
                      fontWeight: 600, 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis' 
                    }}>
                      {tx.description || tx.category}
                    </p>
                  </div>

                  <div className="flex-align-center" style={{ gap: '0.75rem' }}>
                    <span style={{ 
                      fontWeight: 800, 
                      fontSize: '0.95rem',
                      color: isExpense ? 'var(--color-danger)' : 'var(--color-success)'
                    }}>
                      {isExpense ? '' : '+'}{tx.amount.toFixed(2)} {symbol}
                    </span>
                    
                    {tx.type !== 'investment' && (
                      <button 
                        type="button" 
                        className="btn btn-danger btn-icon-only" 
                        style={{ width: '28px', height: '28px', flexShrink: 0 }}
                        onClick={() => handleDeleteTransaction(tx.id)}
                        title="Transaktion löschen"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* 5. Share Child Modal */}
      <Modal
        isOpen={activeModal === 'shareChild'}
        onClose={() => setActiveModal(null)}
        title={`Konto teilen: ${selectedChild?.name}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {formError && (
            <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
              {formError}
            </div>
          )}
          {shareSuccess && (
            <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
              {shareSuccess}
            </div>
          )}

          <div>
            <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Bereits geteilt mit:</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {selectedChild?.parentEmails && selectedChild.parentEmails.length > 0 ? (
                selectedChild.parentEmails.map(email => (
                  <div key={email} className="flex-between" style={{ background: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                    <span>{email}</span>
                    <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>Verknüpft</span>
                  </div>
                ))
              ) : (
                <div className="flex-between" style={{ background: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                  <span>{user?.email}</span>
                  <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>Inhaber</span>
                </div>
              )}

              {selectedChild?.pendingParentEmails?.map(email => (
                <div key={email} className="flex-between" style={{ background: 'var(--bg-primary)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                  <span>{email}</span>
                  <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>Ausstehend</span>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleShareChild} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">E-Mail-Adresse des anderen Elternteils</label>
              <input
                type="email"
                className="form-input"
                placeholder="z.B. mama@email.de"
                value={shareEmail}
                onChange={e => setShareEmail(e.target.value)}
                required
                disabled={shareInvitePending}
              />
            </div>

            {!shareInvitePending ? (
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Freigeben
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <a
                  href={`mailto:${shareEmail.trim().toLowerCase()}?subject=Einladung%20zu%20Easy%20Pocket%20Money&body=Hallo!%20Ich%20habe%20das%20Taschengeld-Konto%20von%20${selectedChild?.name}%20f%C3%BCr%20dich%20freigegeben.%20Bitte%20melde%20dich%20unter%20${window.location.origin}%20an,%20um%20Zugriff%20zu%20erhalten.`}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none', textAlign: 'center' }}
                  onClick={() => {
                    setTimeout(() => {
                      setActiveModal(null);
                      setShareSuccess(null);
                      setShareInvitePending(false);
                      setShareEmail('');
                    }, 1000);
                  }}
                >
                  ✉️ Einladungs-E-Mail senden
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin).then(() => {
                      setShareSuccess('Registrierungs-Link kopiert! Kopiere ihn einfach in eine E-Mail oder einen Messenger.');
                    });
                  }}
                >
                  🔗 Registrierungs-Link kopieren
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setActiveModal(null);
                    setShareSuccess(null);
                    setShareInvitePending(false);
                    setShareEmail('');
                  }}
                >
                  Fertig
                </button>
              </div>
            )}
          </form>
        </div>
      </Modal>
    </div>
  );
};
