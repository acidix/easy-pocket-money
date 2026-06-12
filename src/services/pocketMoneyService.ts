import { 
  isFirebaseConfigured, 
  auth as fbAuth, 
  db as fbDb, 
  googleProvider 
} from '../firebase';
import { 
  signInWithPopup, 
  signOut as fbSignOut, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged as fbOnAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  writeBatch,
  getDocs,
  deleteDoc,
  runTransaction
} from 'firebase/firestore';
import type { UserProfile, Transaction, AllowanceInterval, InvestmentOffer, Investment } from '../types';

// Check if we are running in Mock (LocalStorage) mode
export const isDemoMode = !isFirebaseConfigured;

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// Interval configurations in milliseconds
const INTERVAL_MS: Record<AllowanceInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

// ==========================================
// AUTO-CREDIT UTILITY
// ==========================================
export function processAutoCredits(child: UserProfile): { 
  updatedChild: UserProfile; 
  newTransactions: Omit<Transaction, 'id'>[]; 
} {
  if (child.role !== 'child' || !child.allowances || child.allowances.length === 0) {
    return { updatedChild: child, newTransactions: [] };
  }

  const now = Date.now();
  let balanceChange = 0;
  const newTransactions: Omit<Transaction, 'id'>[] = [];
  const updatedAllowances = child.allowances.map(allowance => {
    const intervalMs = INTERVAL_MS[allowance.interval];
    const elapsed = now - allowance.lastCreditTimestamp;

    if (elapsed >= intervalMs) {
      const creditCount = Math.floor(elapsed / intervalMs);
      
      for (let i = 1; i <= creditCount; i++) {
        const creditTime = allowance.lastCreditTimestamp + i * intervalMs;
        newTransactions.push({
          userId: child.uid,
          amount: allowance.amount,
          type: 'allowance',
          category: 'Taschengeld',
          description: allowance.name || 'Automatisches Taschengeld',
          date: creditTime,
          createdBy: 'parent'
        });
      }

      balanceChange += creditCount * allowance.amount;
      return {
        ...allowance,
        lastCreditTimestamp: allowance.lastCreditTimestamp + creditCount * intervalMs
      };
    }
    return allowance;
  });

  if (newTransactions.length > 0) {
    return {
      updatedChild: {
        ...child,
        allowances: updatedAllowances,
        balance: Number((child.balance + balanceChange).toFixed(2))
      },
      newTransactions
    };
  }

  return { updatedChild: child, newTransactions: [] };
}

// ==========================================
// FESTGELD MATURITY & STOCK PRICE SERVICES
// ==========================================
export function processFestgeldMaturity(
  child: UserProfile, 
  investments: Investment[]
): {
  updatedChild: UserProfile;
  updatedInvestments: Investment[];
  newTransactions: Omit<Transaction, 'id'>[];
} {
  const now = Date.now();
  let balanceChange = 0;
  const newTransactions: Omit<Transaction, 'id'>[] = [];
  const updatedInvestments = investments.map(inv => {
    if (inv.type === 'festgeld' && inv.status === 'active' && inv.endDate && inv.endDate <= now) {
      const payout = inv.amountMatured || inv.amountInvested;
      balanceChange += payout;
      
      newTransactions.push({
        userId: child.uid,
        amount: payout,
        type: 'investment',
        category: 'Festgeld Auszahlung',
        description: `Festgeld Auszahlung: ${inv.name} (inkl. Zinsen)`,
        date: inv.endDate,
        createdBy: 'parent'
      });

      return {
        ...inv,
        status: 'completed' as const
      };
    }
    return inv;
  });

  if (newTransactions.length > 0) {
    return {
      updatedChild: {
        ...child,
        balance: Number((child.balance + balanceChange).toFixed(2))
      },
      updatedInvestments,
      newTransactions
    };
  }

  return { updatedChild: child, updatedInvestments, newTransactions: [] };
}

export async function fetchFundPrice(symbol: string, apiKey?: string): Promise<number> {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!cleanSymbol) return 0;

  const getSimulatedPrice = (sym: string) => {
    let hash = 0;
    for (let i = 0; i < sym.length; i++) {
      hash = sym.charCodeAt(i) + ((hash << 5) - hash);
    }
    const basePrice = Math.abs(hash % 150) + 10;
    const now = Date.now();
    const timeFactor = Math.sin(now / (1000 * 60 * 10)) * 0.04;
    const randomFactor = Math.cos((now + hash) / (1000 * 60 * 60 * 4)) * 0.08;
    return Number((basePrice * (1 + timeFactor + randomFactor)).toFixed(2));
  };

  if (!apiKey) {
    return getSimulatedPrice(cleanSymbol);
  }

  interface CachedPrice {
    price: number;
    timestamp: number;
  }

  // 1. Check shared Firestore cache (valid for 60 seconds)
  if (!isDemoMode && fbDb) {
    try {
      const docRef = doc(fbDb, 'stockPrices', cleanSymbol);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.price && data.timestamp && Date.now() - data.timestamp < 60000) {
          return data.price;
        }
      }
    } catch (e) {
      console.warn('Error reading Firestore price cache:', e);
    }
  }

  // 2. Check LocalStorage cache (always used as local device/offline cache)
  try {
    const cacheStr = localStorage.getItem('EPM_PRICE_CACHE');
    if (cacheStr) {
      const cache: Record<string, CachedPrice> = JSON.parse(cacheStr);
      const entry = cache[cleanSymbol];
      if (entry && Date.now() - entry.timestamp < 60000) {
        return entry.price;
      }
    }
  } catch (e) {
    console.warn('Error reading local price cache:', e);
  }

  // 3. Cache missed or expired: Fetch from external API
  try {
    const url = `https://api.twelvedata.com/price?symbol=${cleanSymbol}&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('API response error');
    
    const data = await response.json();
    if (data && data.price) {
      const parsedPrice = parseFloat(data.price);
      if (!isNaN(parsedPrice) && parsedPrice > 0) {
        const finalPrice = Number(parsedPrice.toFixed(2));

        // Save to Firestore shared cache
        if (!isDemoMode && fbDb) {
          try {
            const docRef = doc(fbDb, 'stockPrices', cleanSymbol);
            await setDoc(docRef, {
              price: finalPrice,
              timestamp: Date.now()
            });
          } catch (e) {
            console.warn('Error writing Firestore price cache:', e);
          }
        }

        // Save to LocalStorage cache
        try {
          const cacheStr = localStorage.getItem('EPM_PRICE_CACHE');
          const cache: Record<string, CachedPrice> = cacheStr ? JSON.parse(cacheStr) : {};
          cache[cleanSymbol] = {
            price: finalPrice,
            timestamp: Date.now()
          };
          localStorage.setItem('EPM_PRICE_CACHE', JSON.stringify(cache));
        } catch (e) {
          console.warn('Error writing local price cache:', e);
        }

        return finalPrice;
      }
    }
    throw new Error(data?.message || 'Price format error');
  } catch (error) {
    console.warn(`Error fetching live price for ${cleanSymbol}, falling back to simulation:`, error);
    
    // If API call fails (rate limit, network issue), fall back to any stale cached price before simulation
    if (!isDemoMode && fbDb) {
      try {
        const docRef = doc(fbDb, 'stockPrices', cleanSymbol);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.price) {
            return data.price;
          }
        }
      } catch {
        // Ignore
      }
    }

    try {
      const cacheStr = localStorage.getItem('EPM_PRICE_CACHE');
      if (cacheStr) {
        const cache: Record<string, CachedPrice> = JSON.parse(cacheStr);
        const entry = cache[cleanSymbol];
        if (entry && entry.price) {
          return entry.price;
        }
      }
    } catch {
      // Ignore
    }

    return getSimulatedPrice(cleanSymbol);
  }
}

// ==========================================
// MOCK DATABASE & AUTH IMPLEMENTATION
// ==========================================
class MockDatabase {
  private getUsers(): Record<string, UserProfile> {
    const data = localStorage.getItem('EPM_USERS');
    return data ? JSON.parse(data) : {};
  }

  private saveUsers(users: Record<string, UserProfile>) {
    localStorage.setItem('EPM_USERS', JSON.stringify(users));
  }

  private getTransactions(): Transaction[] {
    const data = localStorage.getItem('EPM_TRANSACTIONS');
    return data ? JSON.parse(data) : [];
  }

  private saveTransactions(txs: Transaction[]) {
    localStorage.setItem('EPM_TRANSACTIONS', JSON.stringify(txs));
  }

  // Auth States
  public currentUser: UserProfile | null = null;
  private authListeners: ((user: UserProfile | null) => void)[] = [];

  constructor() {
    // Load active session if exists
    const session = localStorage.getItem('EPM_SESSION');
    if (session) {
      this.currentUser = JSON.parse(session);
    }
  }

  private notifyAuthListeners() {
    this.authListeners.forEach(cb => cb(this.currentUser));
  }

  public onAuthStateChanged(callback: (user: UserProfile | null) => void) {
    this.authListeners.push(callback);
    callback(this.currentUser);
    return () => {
      this.authListeners = this.authListeners.filter(cb => cb !== callback);
    };
  }

  public async loginWithGoogle(): Promise<UserProfile> {
    // Mock login for Parent
    const mockGoogleUid = 'google_parent_123';
    const users = this.getUsers();
    
    if (!users[mockGoogleUid]) {
      users[mockGoogleUid] = {
        uid: mockGoogleUid,
        name: 'Elternteil (Demo)',
        email: 'eltern@easy-pocket-money.de',
        role: 'parent',
        parentIds: [],
        allowances: [],
        currency: 'EUR',
        balance: 0
      };
      this.saveUsers(users);
    }

    this.currentUser = users[mockGoogleUid];
    localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
    this.notifyAuthListeners();
    return this.currentUser;
  }

  public async loginChild(username: string, pin: string): Promise<UserProfile> {
    const users = this.getUsers();
    const cleanUsername = username.trim().toLowerCase();
    
    const child = Object.values(users).find(
      u => u.role === 'child' && u.username?.toLowerCase() === cleanUsername
    );

    if (!child) {
      throw new Error('Benutzername nicht gefunden.');
    }

    // In Mock, we store the PIN in local storage EPM_PINS
    const pins = JSON.parse(localStorage.getItem('EPM_PINS') || '{}');
    if (pins[child.uid] !== pin) {
      throw new Error('Falscher PIN.');
    }

    // Process auto credits on login
    const { updatedChild, newTransactions } = processAutoCredits(child);
    if (newTransactions.length > 0) {
      users[child.uid] = updatedChild;
      this.saveUsers(users);
      
      const txs = this.getTransactions();
      const createdTxs = newTransactions.map(t => ({ ...t, id: generateId() }));
      this.saveTransactions([...txs, ...createdTxs]);
    }

    this.currentUser = users[child.uid];
    localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
    this.notifyAuthListeners();
    return this.currentUser;
  }

  public async logout() {
    this.currentUser = null;
    localStorage.removeItem('EPM_SESSION');
    this.notifyAuthListeners();
  }

  // DB Methods
  public async getUser(uid: string): Promise<UserProfile | null> {
    const users = this.getUsers();
    let user = users[uid];
    if (user && user.role === 'child') {
      let changed = false;
      
      // Auto credit on fetch
      const { updatedChild, newTransactions } = processAutoCredits(user);
      if (newTransactions.length > 0) {
        user = updatedChild;
        users[uid] = user;
        changed = true;
        
        const txs = this.getTransactions();
        const createdTxs = newTransactions.map(t => ({ ...t, id: generateId() }));
        this.saveTransactions([...txs, ...createdTxs]);
      }

      // Check Festgeld maturity
      const investments = this.getInvestments();
      const childInvs = investments.filter(inv => inv.userId === uid);
      const maturityRes = processFestgeldMaturity(user, childInvs);
      if (maturityRes.newTransactions.length > 0) {
        user = maturityRes.updatedChild;
        users[uid] = user;
        changed = true;
        
        const otherInvs = investments.filter(inv => inv.userId !== uid);
        this.saveInvestments([...otherInvs, ...maturityRes.updatedInvestments]);
        
        const txs = this.getTransactions();
        const createdTxs = maturityRes.newTransactions.map(t => ({ ...t, id: generateId() }));
        this.saveTransactions([...txs, ...createdTxs]);
      }

      if (changed) {
        this.saveUsers(users);
      }
    }
    return user || null;
  }

  public async updateUserProfile(uid: string, fields: Partial<UserProfile>) {
    const users = this.getUsers();
    if (users[uid]) {
      users[uid] = { ...users[uid], ...fields } as UserProfile;
      this.saveUsers(users);
      
      // Update session if it's the current user
      if (this.currentUser?.uid === uid) {
        this.currentUser = users[uid];
        localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
        this.notifyAuthListeners();
      }
    }
  }

  public async createChild(
    name: string, 
    username: string, 
    pin: string, 
    parentUid: string,
    currency: string
  ): Promise<UserProfile> {
    const users = this.getUsers();
    const cleanUsername = username.trim().toLowerCase();

    const exists = Object.values(users).some(
      u => u.username?.toLowerCase() === cleanUsername
    );
    if (exists) {
      throw new Error('Dieser Benutzername ist bereits vergeben.');
    }

    const childUid = 'child_' + generateId();
    const newChild: UserProfile = {
      uid: childUid,
      name,
      username: cleanUsername,
      role: 'child',
      parentIds: [parentUid],
      allowances: [],
      currency,
      balance: 0,
      giroBalance: 0
    };

    users[childUid] = newChild;
    this.saveUsers(users);

    // Save PIN
    const pins = JSON.parse(localStorage.getItem('EPM_PINS') || '{}');
    pins[childUid] = pin;
    localStorage.setItem('EPM_PINS', JSON.stringify(pins));

    return newChild;
  }

  public async linkParentToChild(childUsername: string, parentUid: string): Promise<UserProfile> {
    const users = this.getUsers();
    const cleanUsername = childUsername.trim().toLowerCase();
    
    const child = Object.values(users).find(
      u => u.role === 'child' && u.username?.toLowerCase() === cleanUsername
    );

    if (!child) {
      throw new Error('Kind-Benutzername nicht gefunden.');
    }

    if (child.parentIds.includes(parentUid)) {
      throw new Error('Du bist bereits als Elternteil für dieses Kind eingetragen.');
    }

    child.parentIds.push(parentUid);
    users[child.uid] = child;
    this.saveUsers(users);
    return child;
  }

  public subscribeToChildren(parentUid: string, callback: (children: UserProfile[]) => void) {
    let lastJson = '';
    const fetchChildren = () => {
      try {
        const users = this.getUsers();
        const children = Object.values(users).filter(
          u => u.role === 'child' && u.parentIds && u.parentIds.includes(parentUid)
        );

        // Auto check credit on each child
        let changed = false;
        const updatedChildren = children.map(child => {
          let activeChild = child;
          const { updatedChild, newTransactions } = processAutoCredits(activeChild);
          if (newTransactions.length > 0) {
            activeChild = updatedChild;
            users[child.uid] = activeChild;
            changed = true;
            
            const txs = this.getTransactions();
            const createdTxs = newTransactions.map(t => ({ ...t, id: generateId() }));
            this.saveTransactions([...txs, ...createdTxs]);
          }

          // Process Festgeld maturity
          const investments = this.getInvestments();
          const childInvs = investments.filter(inv => inv.userId === child.uid);
          const maturityRes = processFestgeldMaturity(activeChild, childInvs);
          if (maturityRes.newTransactions.length > 0) {
            activeChild = maturityRes.updatedChild;
            users[child.uid] = activeChild;
            changed = true;
            
            const otherInvs = investments.filter(inv => inv.userId !== child.uid);
            this.saveInvestments([...otherInvs, ...maturityRes.updatedInvestments]);
            
            const txs = this.getTransactions();
            const createdTxs = maturityRes.newTransactions.map(t => ({ ...t, id: generateId() }));
            this.saveTransactions([...txs, ...createdTxs]);
          }

          return users[child.uid];
        });

        if (changed) {
          this.saveUsers(users);
        }

        const currentJson = JSON.stringify(updatedChildren);
        if (currentJson !== lastJson) {
          lastJson = currentJson;
          callback(updatedChildren);
        }
      } catch (err) {
        console.error('[mockDb.subscribeToChildren] Exception caught:', err);
        callback([]);
      }
    };

    fetchChildren();
    
    // Simple custom interval polling to mimic Firestore reactive listener (every 2 seconds)
    const interval = setInterval(fetchChildren, 2000);
    return () => {
      clearInterval(interval);
    };
  }

  public subscribeToTransactions(userId: string, callback: (txs: Transaction[]) => void) {
    let lastJson = '';
    const fetchTxs = () => {
      const txs = this.getTransactions();
      const filtered = txs
        .filter(t => t.userId === userId)
        .sort((a, b) => b.date - a.date);
      const currentJson = JSON.stringify(filtered);
      if (currentJson !== lastJson) {
        lastJson = currentJson;
        callback(filtered);
      }
    };

    fetchTxs();
    const interval = setInterval(fetchTxs, 2000);
    return () => clearInterval(interval);
  }

  public async addTransaction(tx: Omit<Transaction, 'id'>) {
    const txs = this.getTransactions();
    const newTx: Transaction = {
      ...tx,
      id: 'tx_' + generateId()
    };
    txs.push(newTx);
    this.saveTransactions(txs);

    // Update user balance
    const users = this.getUsers();
    const user = users[tx.userId];
    if (user) {
      user.balance = Number((user.balance + tx.amount).toFixed(2));
      users[tx.userId] = user;
      this.saveUsers(users);
      
      if (this.currentUser?.uid === tx.userId) {
        this.currentUser = user;
        localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
        this.notifyAuthListeners();
      }
    }
  }

  public async deleteTransaction(txId: string) {
    const txs = this.getTransactions();
    const tx = txs.find(t => t.id === txId);
    if (!tx) return;

    this.saveTransactions(txs.filter(t => t.id !== txId));

    // Revert user balance
    const users = this.getUsers();
    const user = users[tx.userId];
    if (user) {
      user.balance = Number((user.balance - tx.amount).toFixed(2));
      users[tx.userId] = user;
      this.saveUsers(users);

      if (this.currentUser?.uid === tx.userId) {
        this.currentUser = user;
        localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
        this.notifyAuthListeners();
      }
    }
  }

  // Investment Offers
  private getOffers(): InvestmentOffer[] {
    const data = localStorage.getItem('EPM_OFFERS');
    return data ? JSON.parse(data) : [];
  }

  private saveOffers(offers: InvestmentOffer[]) {
    localStorage.setItem('EPM_OFFERS', JSON.stringify(offers));
  }

  public subscribeToInvestmentOffers(parentUid: string, callback: (offers: InvestmentOffer[]) => void) {
    let lastJson = '';
    const fetchOffers = () => {
      const offers = this.getOffers();
      const filtered = offers.filter(o => o.parentId === parentUid);
      const currentJson = JSON.stringify(filtered);
      if (currentJson !== lastJson) {
        lastJson = currentJson;
        callback(filtered);
      }
    };

    fetchOffers();
    const interval = setInterval(fetchOffers, 2000);
    return () => clearInterval(interval);
  }

  public async addInvestmentOffer(offer: Omit<InvestmentOffer, 'id'>): Promise<InvestmentOffer> {
    const offers = this.getOffers();
    const newOffer: InvestmentOffer = {
      ...offer,
      id: 'offer_' + generateId()
    };
    offers.push(newOffer);
    this.saveOffers(offers);
    return newOffer;
  }

  public async deleteInvestmentOffer(offerId: string) {
    const offers = this.getOffers();
    this.saveOffers(offers.filter(o => o.id !== offerId));
  }

  // Investments
  public getInvestments(): Investment[] {
    const data = localStorage.getItem('EPM_INVESTMENTS');
    return data ? JSON.parse(data) : [];
  }

  public saveInvestments(invs: Investment[]) {
    localStorage.setItem('EPM_INVESTMENTS', JSON.stringify(invs));
  }

  public subscribeToInvestments(userId: string, callback: (investments: Investment[]) => void) {
    let lastJson = '';
    const fetchInvs = () => {
      const investments = this.getInvestments();
      const filtered = investments.filter(i => i.userId === userId);
      const currentJson = JSON.stringify(filtered);
      if (currentJson !== lastJson) {
        lastJson = currentJson;
        callback(filtered);
      }
    };

    fetchInvs();
    const interval = setInterval(fetchInvs, 2000);
    return () => clearInterval(interval);
  }

  public subscribeToUser(uid: string, callback: (user: UserProfile | null) => void) {
    let lastJson = '';
    const fetchUser = () => {
      const users = this.getUsers();
      const user = users[uid] || null;
      const currentJson = JSON.stringify(user);
      if (currentJson !== lastJson) {
        lastJson = currentJson;
        callback(user);
      }
    };

    fetchUser();
    const interval = setInterval(fetchUser, 2000);
    return () => clearInterval(interval);
  }

  public async depositToGiro(userId: string, amount: number) {
    const users = this.getUsers();
    const child = users[userId];
    if (!child) throw new Error('Kind nicht gefunden.');
    if (child.balance < amount) {
      throw new Error('Nicht genügend Guthaben im Portemonnaie.');
    }

    const oldGiro = child.giroBalance || 0;
    const newGiro = Number((oldGiro + amount).toFixed(2));

    // Add transaction reducing wallet balance
    await this.addTransaction({
      userId,
      amount: -amount,
      type: 'manual',
      category: 'Girokonto Einzahlung',
      description: 'Einzahlung auf Girokonto',
      date: Date.now(),
      createdBy: 'child',
      giroDelta: amount,
      giroBalanceAfter: newGiro
    });

    // Update giroBalance (since addTransaction already saved users, reload users and update giroBalance)
    const updatedUsers = this.getUsers();
    const updatedChild = updatedUsers[userId];
    updatedChild.giroBalance = newGiro;
    updatedUsers[userId] = updatedChild;
    this.saveUsers(updatedUsers);

    if (this.currentUser?.uid === userId) {
      this.currentUser = updatedChild;
      localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
      this.notifyAuthListeners();
    }
  }

  public async changeChildPin(userId: string, oldPin: string, newPin: string) {
    const pins = JSON.parse(localStorage.getItem('EPM_PINS') || '{}');
    if (pins[userId] !== oldPin) {
      throw new Error('Die alte PIN ist nicht korrekt.');
    }
    pins[userId] = newPin;
    localStorage.setItem('EPM_PINS', JSON.stringify(pins));
  }

  public async createInvestment(inv: Omit<Investment, 'id'>): Promise<Investment> {
    const investments = this.getInvestments();
    const newInv: Investment = {
      ...inv,
      id: 'inv_' + generateId()
    };
    investments.push(newInv);
    this.saveInvestments(investments);

    // Add deduction transaction
    await this.addTransaction({
      userId: inv.userId,
      amount: -inv.amountInvested,
      type: 'investment',
      category: inv.type === 'festgeld' ? 'Festgeld Anlage' : 'Aktienfonds Kauf',
      description: `Anlage: ${inv.name}`,
      date: inv.startDate,
      createdBy: 'child'
    });

    return newInv;
  }

  public async sellInvestment(investmentId: string, sellPrice: number, sharesToSell?: number) {
    const investments = this.getInvestments();
    const idx = investments.findIndex(i => i.id === investmentId);
    if (idx === -1) return;

    const inv = investments[idx];
    if (inv.type !== 'aktienfonds' || inv.status !== 'active') return;

    const totalShares = inv.sharesOwned || 0;
    const sellAll = !sharesToSell || sharesToSell >= totalShares;
    const actualSharesToSell = sellAll ? totalShares : sharesToSell!;

    const payout = Number((actualSharesToSell * sellPrice).toFixed(2));
    const now = Date.now();

    if (sellAll) {
      const updatedInv: Investment = {
        ...inv,
        status: 'sold',
        sellPrice,
        sellDate: now,
        amountSold: payout
      };
      investments[idx] = updatedInv;
    } else {
      const costBasisSold = Number((inv.amountInvested * (actualSharesToSell / totalShares)).toFixed(2));
      const updatedInv: Investment = {
        ...inv,
        sharesOwned: Number((totalShares - actualSharesToSell).toFixed(6)),
        amountInvested: Number((inv.amountInvested - costBasisSold).toFixed(2))
      };
      investments[idx] = updatedInv;
    }

    this.saveInvestments(investments);

    // Add payout transaction
    await this.addTransaction({
      userId: inv.userId,
      amount: payout,
      type: 'investment',
      category: sellAll ? 'Aktienfonds Verkauf' : 'Aktienfonds Teilverkauf',
      description: sellAll
        ? `Verkauf Anlage: ${inv.name} (${actualSharesToSell.toFixed(4)} Anteile)`
        : `Teilverkauf Anlage: ${inv.name} (${actualSharesToSell.toFixed(4)} Anteile)`,
      date: now,
      createdBy: 'child'
    });
  }

  public async checkFestgeldMaturity(userId: string) {
    const users = this.getUsers();
    const user = users[userId];
    if (!user || user.role !== 'child') return;

    const investments = this.getInvestments();
    const childInvs = investments.filter(inv => inv.userId === userId);
    const res = processFestgeldMaturity(user, childInvs);
    
    if (res.newTransactions.length > 0) {
      users[userId] = res.updatedChild;
      this.saveUsers(users);
      
      const otherInvs = investments.filter(inv => inv.userId !== userId);
      this.saveInvestments([...otherInvs, ...res.updatedInvestments]);
      
      const txs = this.getTransactions();
      const createdTxs = res.newTransactions.map(t => ({
        ...t,
        id: 'tx_' + generateId()
      }));
      this.saveTransactions([...txs, ...createdTxs]);

      if (this.currentUser?.uid === userId) {
        this.currentUser = res.updatedChild;
        localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
        this.notifyAuthListeners();
      }
    }
  }

  public async updateTransaction(txId: string, updatedFields: Partial<Transaction>, oldAmount: number) {
    const txs = this.getTransactions();
    const txIndex = txs.findIndex(t => t.id === txId);
    if (txIndex === -1) return;

    const oldTx = txs[txIndex];
    const newTx = { ...oldTx, ...updatedFields } as Transaction;
    txs[txIndex] = newTx;
    this.saveTransactions(txs);

    // Update user balance
    const users = this.getUsers();
    const user = users[oldTx.userId];
    if (user) {
      const diff = newTx.amount - oldAmount;
      user.balance = Number((user.balance + diff).toFixed(2));
      users[oldTx.userId] = user;
      this.saveUsers(users);

      if (this.currentUser?.uid === oldTx.userId) {
        this.currentUser = user;
        localStorage.setItem('EPM_SESSION', JSON.stringify(this.currentUser));
        this.notifyAuthListeners();
      }
    }
  }
}

const mockDb = new MockDatabase();

// ==========================================
// UNIFIED POCKET MONEY SERVICE
// ==========================================
export const pocketMoneyService = {
  
  onAuthStateChanged: (callback: (user: UserProfile | null) => void) => {
    if (isDemoMode) {
      return mockDb.onAuthStateChanged(callback);
    }

    return fbOnAuthStateChanged(fbAuth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        callback(null);
        return;
      }

      // Check if user exists in database
      const userDocRef = doc(fbDb, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        let profile = userSnap.data() as UserProfile;
        if (profile.role === 'child') {
          // Process credits
          const { updatedChild, newTransactions } = processAutoCredits(profile);
          if (newTransactions.length > 0) {
            const batch = writeBatch(fbDb);
            batch.set(userDocRef, updatedChild);
            
            newTransactions.forEach(t => {
              const txRef = doc(collection(fbDb, 'transactions'));
              batch.set(txRef, { ...t, id: txRef.id });
            });
            await batch.commit();
            profile = updatedChild;
          }
        }
        callback(profile);
      } else {
        // Create new Parent profile (children are created by parents first)
        const newParent: UserProfile = {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'Elternteil',
          email: firebaseUser.email || undefined,
          role: 'parent',
          parentIds: [],
          allowances: [],
          currency: 'EUR',
          balance: 0
        };
        await setDoc(userDocRef, newParent);
        callback(newParent);
      }
    });
  },

  loginWithGoogle: async (): Promise<UserProfile> => {
    if (isDemoMode) {
      return mockDb.loginWithGoogle();
    }

    const result = await signInWithPopup(fbAuth, googleProvider);
    const firebaseUser = result.user;

    const userDocRef = doc(fbDb, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userDocRef);

    if (userSnap.exists()) {
      return userSnap.data() as UserProfile;
    } else {
      const newParent: UserProfile = {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || 'Elternteil',
        email: firebaseUser.email || undefined,
        role: 'parent',
        parentIds: [],
        allowances: [],
        currency: 'EUR',
        balance: 0
      };
      await setDoc(userDocRef, newParent);
      return newParent;
    }
  },

  loginChild: async (username: string, pin: string): Promise<UserProfile> => {
    const cleanUsername = username.trim().toLowerCase();
    
    if (isDemoMode) {
      return mockDb.loginChild(cleanUsername, pin);
    }

    // Under the hood, children log in via email: username@pocketmoney.internal
    const email = `${cleanUsername}@pocketmoney.internal`;
    const result = await signInWithEmailAndPassword(fbAuth, email, pin);
    const firebaseUser = result.user;

    const userDocRef = doc(fbDb, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userDocRef);

    if (!userSnap.exists()) {
      throw new Error('Benutzerprofildaten konnten nicht geladen werden.');
    }

    let profile = userSnap.data() as UserProfile;
    const { updatedChild, newTransactions } = processAutoCredits(profile);
    if (newTransactions.length > 0) {
      const batch = writeBatch(fbDb);
      batch.set(userDocRef, updatedChild);
      newTransactions.forEach(t => {
        const txRef = doc(collection(fbDb, 'transactions'));
        batch.set(txRef, { ...t, id: txRef.id });
      });
      await batch.commit();
      profile = updatedChild;
    }

    // Check Festgeld maturity
    await pocketMoneyService.checkFestgeldMaturity(profile.uid);
    const freshSnap = await getDoc(userDocRef);
    profile = freshSnap.data() as UserProfile;

    return profile;
  },

  logout: async () => {
    if (isDemoMode) {
      return mockDb.logout();
    }
    return fbSignOut(fbAuth);
  },

  getUser: async (uid: string): Promise<UserProfile | null> => {
    if (isDemoMode) {
      return mockDb.getUser(uid);
    }

    const docRef = doc(fbDb, 'users', uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      let profile = docSnap.data() as UserProfile;
      if (profile.role === 'child') {
        const { updatedChild, newTransactions } = processAutoCredits(profile);
        if (newTransactions.length > 0) {
          const batch = writeBatch(fbDb);
          batch.set(docRef, updatedChild);
          newTransactions.forEach(t => {
            const txRef = doc(collection(fbDb, 'transactions'));
            batch.set(txRef, { ...t, id: txRef.id });
          });
          await batch.commit();
        }

        // Check Festgeld maturity
        await pocketMoneyService.checkFestgeldMaturity(uid);
        const freshSnap = await getDoc(docRef);
        profile = freshSnap.data() as UserProfile;
      }
      return profile;
    }
    return null;
  },

  updateUserProfile: async (uid: string, fields: Partial<UserProfile>) => {
    if (isDemoMode) {
      return mockDb.updateUserProfile(uid, fields);
    }
    const docRef = doc(fbDb, 'users', uid);
    return updateDoc(docRef, fields);
  },

  createChild: async (
    name: string, 
    username: string, 
    pin: string, 
    parentUid: string,
    currency: string
  ): Promise<UserProfile> => {
    const cleanUsername = username.trim().toLowerCase();

    if (isDemoMode) {
      return mockDb.createChild(name, cleanUsername, pin, parentUid, currency);
    }


    
    // To do query in Firestore:
    // Actually, we can fetch if username exists by doing a firestore query or we register auth email first.
    // If auth registration fails, it means email (username) is taken! This is a perfect native unique index.
    const email = `${cleanUsername}@pocketmoney.internal`;
    
    try {
      const credential = await createUserWithEmailAndPassword(fbAuth, email, pin);
      const childUid = credential.user.uid;

      const newChild: UserProfile = {
        uid: childUid,
        name,
        username: cleanUsername,
        role: 'child',
        parentIds: [parentUid],
        allowances: [],
        currency,
        balance: 0,
        giroBalance: 0
      };

      await setDoc(doc(fbDb, 'users', childUid), newChild);
      return newChild;
    } catch (authError: unknown) {
      const errCode = (authError && typeof authError === 'object' && 'code' in authError) ? (authError as { code: string }).code : '';
      if (errCode === 'auth/email-already-in-use') {
        throw new Error('Dieser Benutzername ist bereits vergeben.', { cause: authError });
      } else if (errCode === 'auth/weak-password') {
        throw new Error('Der PIN muss mindestens 6 Zeichen lang sein.', { cause: authError });
      }
      throw authError;
    }
  },

  linkParentToChild: async (childUsername: string, parentUid: string): Promise<UserProfile> => {
    const cleanUsername = childUsername.trim().toLowerCase();

    if (isDemoMode) {
      return mockDb.linkParentToChild(cleanUsername, parentUid);
    }

    // Find the child in firestore
    // We cannot query client-side easily without permissions, but since parents can read children, we can use a query
    // Wait, Firestore query is fine if security rules permit it. Or parents can query the users collection where username == cleanUsername.
    // Let's assume we retrieve the child's ID by a query:
    throw new Error('Das Hinzufügen bestehender Kinder zu weiteren Eltern ist in der Cloud-Version derzeit nur über den Support möglich.');
    // Let's implement this on Mock only or we can do a Firestore collectionGroup / query if rules allow.
    // For simplicity in UI, we'll expose a link action.
  },

  subscribeToChildren: (parentUid: string, callback: (children: UserProfile[]) => void) => {
    if (isDemoMode) {
      return mockDb.subscribeToChildren(parentUid, callback);
    }

    const q = query(
      collection(fbDb, 'users'), 
      where('parentIds', 'array-contains', parentUid)
    );

    return onSnapshot(q, async (snapshot) => {
      const children: UserProfile[] = [];
      const batch = writeBatch(fbDb);
      let needsBatch = false;

      for (const d of snapshot.docs) {
        let child = d.data() as UserProfile;
        const { updatedChild, newTransactions } = processAutoCredits(child);
        if (newTransactions.length > 0) {
          batch.set(doc(fbDb, 'users', child.uid), updatedChild);
          newTransactions.forEach(t => {
            const txRef = doc(collection(fbDb, 'transactions'));
            batch.set(txRef, { ...t, id: txRef.id });
          });
          needsBatch = true;
          child = updatedChild;
        }
        children.push(child);
      }

      if (needsBatch) {
        await batch.commit();
      }
      callback(children);
    }, (error) => {
      console.error("[pocketMoneyService.subscribeToChildren] Firestore Mode: Snapshot error!", error);
      callback([]);
    });
  },

  subscribeToTransactions: (userId: string, callback: (txs: Transaction[]) => void) => {
    if (isDemoMode) {
      return mockDb.subscribeToTransactions(userId, callback);
    }

    const q = query(
      collection(fbDb, 'transactions'),
      where('userId', '==', userId)
    );

    return onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(d => d.data() as Transaction);
      txs.sort((a, b) => b.date - a.date);
      callback(txs);
    }, (error) => {
      console.error('Error in subscribeToTransactions onSnapshot:', error);
      callback([]);
    });
  },

  addTransaction: async (tx: Omit<Transaction, 'id'>) => {
    if (isDemoMode) {
      return mockDb.addTransaction(tx);
    }

    // 1. Get child ref and update their balance
    const userDocRef = doc(fbDb, 'users', tx.userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) throw new Error('Kind existiert nicht.');

    const user = userSnap.data() as UserProfile;
    const newBalance = Number((user.balance + tx.amount).toFixed(2));

    const batch = writeBatch(fbDb);
    // Update balance
    batch.update(userDocRef, { balance: newBalance });
    
    // Add transaction
    const txRef = doc(collection(fbDb, 'transactions'));
    const newTx: Transaction = {
      ...tx,
      id: txRef.id
    };
    batch.set(txRef, newTx);

    return batch.commit();
  },

  deleteTransaction: async (txId: string) => {
    if (isDemoMode) {
      return mockDb.deleteTransaction(txId);
    }

    const txDocRef = doc(fbDb, 'transactions', txId);
    const txSnap = await getDoc(txDocRef);
    if (!txSnap.exists()) return;

    const tx = txSnap.data() as Transaction;
    const userDocRef = doc(fbDb, 'users', tx.userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) return;

    const user = userSnap.data() as UserProfile;
    const newBalance = Number((user.balance - tx.amount).toFixed(2));

    const batch = writeBatch(fbDb);
    batch.update(userDocRef, { balance: newBalance });
    batch.delete(txDocRef);

    return batch.commit();
  },

  updateTransaction: async (txId: string, updatedFields: Partial<Transaction>, oldAmount: number) => {
    if (isDemoMode) {
      return mockDb.updateTransaction(txId, updatedFields, oldAmount);
    }

    const txDocRef = doc(fbDb, 'transactions', txId);
    const txSnap = await getDoc(txDocRef);
    if (!txSnap.exists()) return;

    const tx = txSnap.data() as Transaction;
    const userDocRef = doc(fbDb, 'users', tx.userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) return;

    const user = userSnap.data() as UserProfile;
    const newAmount = updatedFields.amount !== undefined ? updatedFields.amount : tx.amount;
    const diff = newAmount - oldAmount;
    const newBalance = Number((user.balance + diff).toFixed(2));

    const batch = writeBatch(fbDb);
    batch.update(userDocRef, { balance: newBalance });
    batch.update(txDocRef, updatedFields);

    return batch.commit();
  },

  subscribeToInvestmentOffers: (parentUid: string, callback: (offers: InvestmentOffer[]) => void) => {
    if (isDemoMode) {
      return mockDb.subscribeToInvestmentOffers(parentUid, callback);
    }
    const q = query(
      collection(fbDb, 'investmentOffers'),
      where('parentId', '==', parentUid)
    );
    return onSnapshot(q, (snapshot) => {
      const offers = snapshot.docs.map(d => d.data() as InvestmentOffer);
      callback(offers);
    }, (error) => {
      console.error('Error in subscribeToInvestmentOffers onSnapshot:', error);
      callback([]);
    });
  },

  addInvestmentOffer: async (offer: Omit<InvestmentOffer, 'id'>): Promise<InvestmentOffer> => {
    if (isDemoMode) {
      return mockDb.addInvestmentOffer(offer);
    }
    const docRef = doc(collection(fbDb, 'investmentOffers'));
    const newOffer = { ...offer, id: docRef.id };
    await setDoc(docRef, newOffer);
    return newOffer as InvestmentOffer;
  },

  deleteInvestmentOffer: async (offerId: string) => {
    if (isDemoMode) {
      return mockDb.deleteInvestmentOffer(offerId);
    }
    const docRef = doc(fbDb, 'investmentOffers', offerId);
    await deleteDoc(docRef);
  },

  subscribeToUser: (uid: string, callback: (user: UserProfile | null) => void) => {
    if (isDemoMode) {
      return mockDb.subscribeToUser(uid, callback);
    }

    const docRef = doc(fbDb, 'users', uid);
    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        callback(snap.data() as UserProfile);
      } else {
        callback(null);
      }
    }, (error) => {
      console.error('[pocketMoneyService.subscribeToUser] error:', error);
      callback(null);
    });
  },

  depositToGiro: async (userId: string, amount: number) => {
    if (isDemoMode) {
      return mockDb.depositToGiro(userId, amount);
    }

    const userRef = doc(fbDb, 'users', userId);
    await runTransaction(fbDb, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('Kind nicht gefunden.');
      }
      const child = userSnap.data() as UserProfile;
      if (child.balance < amount) {
        throw new Error('Nicht genügend Guthaben im Portemonnaie.');
      }

      const newBalance = Number((child.balance - amount).toFixed(2));
      const newGiro = Number(((child.giroBalance || 0) + amount).toFixed(2));

      // Add transaction document
      const txRef = doc(collection(fbDb, 'transactions'));
      transaction.set(txRef, {
        id: txRef.id,
        userId,
        amount: -amount,
        type: 'manual',
        category: 'Girokonto Einzahlung',
        description: 'Einzahlung auf Girokonto',
        date: Date.now(),
        createdBy: 'child',
        giroDelta: amount,
        giroBalanceAfter: newGiro
      });

      // Update user profile balances
      transaction.update(userRef, {
        balance: newBalance,
        giroBalance: newGiro
      });
    });
  },

  changeChildPin: async (userId: string, oldPin: string, newPin: string) => {
    if (isDemoMode) {
      return mockDb.changeChildPin(userId, oldPin, newPin);
    }

    const currentUser = fbAuth.currentUser;
    if (!currentUser) throw new Error('Nicht eingeloggt.');

    const credential = EmailAuthProvider.credential(currentUser.email!, oldPin);
    try {
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPin);
    } catch (error: unknown) {
      console.error('[pocketMoneyService.changeChildPin] error:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        throw new Error('Die alte PIN ist nicht korrekt.', { cause: error });
      }
      if (err.code === 'auth/weak-password') {
        throw new Error('Die neue PIN muss mindestens 6 Zeichen lang sein.', { cause: error });
      }
      throw new Error('Fehler beim Ändern der PIN: ' + (err.message || String(error)), { cause: error });
    }
  },

  subscribeToInvestments: (userId: string, callback: (investments: Investment[]) => void) => {
    if (isDemoMode) {
      let unsubscribe = () => {};
      mockDb.checkFestgeldMaturity(userId).then(() => {
        unsubscribe = mockDb.subscribeToInvestments(userId, callback);
      });
      return () => unsubscribe();
    }
    
    pocketMoneyService.checkFestgeldMaturity(userId).catch(console.error);
    
    const q = query(
      collection(fbDb, 'investments'),
      where('userId', '==', userId)
    );
    
    return onSnapshot(q, (snapshot) => {
      const investments = snapshot.docs.map(d => d.data() as Investment);
      callback(investments);
    }, (error) => {
      console.error('Error in subscribeToInvestments onSnapshot:', error);
      callback([]);
    });
  },

  createInvestment: async (inv: Omit<Investment, 'id'>): Promise<Investment> => {
    if (isDemoMode) {
      return mockDb.createInvestment(inv);
    }
    
    const userDocRef = doc(fbDb, 'users', inv.userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) throw new Error('Kind existiert nicht.');
    
    const user = userSnap.data() as UserProfile;
    const newBalance = Number((user.balance - inv.amountInvested).toFixed(2));
    
    const batch = writeBatch(fbDb);
    batch.update(userDocRef, { balance: newBalance });
    
    const invRef = doc(collection(fbDb, 'investments'));
    const newInv = { ...inv, id: invRef.id };
    batch.set(invRef, newInv);
    
    const txRef = doc(collection(fbDb, 'transactions'));
    batch.set(txRef, {
      id: txRef.id,
      userId: inv.userId,
      amount: -inv.amountInvested,
      type: 'investment',
      category: inv.type === 'festgeld' ? 'Festgeld Anlage' : 'Aktienfonds Kauf',
      description: `Anlage: ${inv.name}`,
      date: inv.startDate,
      createdBy: 'child'
    });
    
    await batch.commit();
    return newInv as Investment;
  },

  sellInvestment: async (investmentId: string, sellPrice: number, sharesToSell?: number) => {
    if (isDemoMode) {
      return mockDb.sellInvestment(investmentId, sellPrice, sharesToSell);
    }
    
    const invRef = doc(fbDb, 'investments', investmentId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) throw new Error('Anlage existiert nicht.');
    
    const inv = invSnap.data() as Investment;
    if (inv.type !== 'aktienfonds' || inv.status !== 'active') return;
    
    const totalShares = inv.sharesOwned || 0;
    const sellAll = !sharesToSell || sharesToSell >= totalShares;
    const actualSharesToSell = sellAll ? totalShares : sharesToSell!;

    const payout = Number((actualSharesToSell * sellPrice).toFixed(2));
    const now = Date.now();
    
    const userDocRef = doc(fbDb, 'users', inv.userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) throw new Error('Kind existiert nicht.');
    
    const user = userSnap.data() as UserProfile;
    const newBalance = Number((user.balance + payout).toFixed(2));
    
    const batch = writeBatch(fbDb);
    batch.update(userDocRef, { balance: newBalance });
    
    if (sellAll) {
      batch.update(invRef, {
        status: 'sold',
        sellPrice,
        sellDate: now,
        amountSold: payout
      });
    } else {
      const costBasisSold = Number((inv.amountInvested * (actualSharesToSell / totalShares)).toFixed(2));
      batch.update(invRef, {
        sharesOwned: Number((totalShares - actualSharesToSell).toFixed(6)),
        amountInvested: Number((inv.amountInvested - costBasisSold).toFixed(2))
      });
    }
    
    const txRef = doc(collection(fbDb, 'transactions'));
    batch.set(txRef, {
      id: txRef.id,
      userId: inv.userId,
      amount: payout,
      type: 'investment',
      category: sellAll ? 'Aktienfonds Verkauf' : 'Aktienfonds Teilverkauf',
      description: sellAll 
        ? `Verkauf Anlage: ${inv.name} (${actualSharesToSell.toFixed(4)} Anteile)`
        : `Teilverkauf Anlage: ${inv.name} (${actualSharesToSell.toFixed(4)} Anteile)`,
      date: now,
      createdBy: 'child'
    });
    
    await batch.commit();
  },

  checkFestgeldMaturity: async (userId: string) => {
    if (isDemoMode) {
      return mockDb.checkFestgeldMaturity(userId);
    }
    const now = Date.now();
    const q = query(
      collection(fbDb, 'investments'),
      where('userId', '==', userId)
    );
    
    try {
      const snap = await getDocs(q);
      const maturedInvs = snap.docs.filter(d => {
        const inv = d.data() as Investment;
        return inv.type === 'festgeld' && inv.status === 'active' && inv.endDate && inv.endDate <= now;
      });
      if (maturedInvs.length === 0) return;
      
      const userRef = doc(fbDb, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return;
      
      const user = userSnap.data() as UserProfile;
      let balanceChange = 0;
      const batch = writeBatch(fbDb);
      
      maturedInvs.forEach(d => {
        const inv = d.data() as Investment;
        const payout = inv.amountMatured || inv.amountInvested;
        balanceChange += payout;
        
        batch.update(d.ref, { status: 'completed' });
        
        const txRef = doc(collection(fbDb, 'transactions'));
        batch.set(txRef, {
          id: txRef.id,
          userId,
          amount: payout,
          type: 'investment',
          category: 'Festgeld Auszahlung',
          description: `Festgeld Auszahlung: ${inv.name} (inkl. Zinsen)`,
          date: inv.endDate || now,
          createdBy: 'parent'
        });
      });
      
      const newBalance = Number((user.balance + balanceChange).toFixed(2));
      batch.update(userRef, { balance: newBalance });
      
      await batch.commit();
    } catch (err) {
      console.error('Error checking Festgeld maturity:', err);
    }
  }
};
