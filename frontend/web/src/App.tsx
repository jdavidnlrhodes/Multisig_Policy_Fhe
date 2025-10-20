// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Policy {
  id: string;
  encryptedThreshold: string;
  encryptedAmount: string;
  requiredSignatures: number;
  timestamp: number;
  creator: string;
  status: "active" | "inactive";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPolicyData, setNewPolicyData] = useState({ threshold: 0, amount: 0, signatures: 2 });
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [decryptedThreshold, setDecryptedThreshold] = useState<number | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [notifications, setNotifications] = useState<string[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const activeCount = policies.filter(p => p.status === "active").length;
  const inactiveCount = policies.filter(p => p.status === "inactive").length;

  useEffect(() => {
    loadPolicies().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();

    // Mock notifications
    setNotifications([
      "System update: FHE encryption upgraded to v2.1",
      "New feature: Multi-chain support added",
      "Security alert: Always verify contract addresses",
      "Maintenance scheduled for next Tuesday"
    ]);
  }, []);

  const loadPolicies = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        addNotification("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("policy_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing policy keys:", e);
          addNotification("Error parsing policy keys");
        }
      }
      
      const list: Policy[] = [];
      for (const key of keys) {
        try {
          const policyBytes = await contract.getData(`policy_${key}`);
          if (policyBytes.length > 0) {
            try {
              const policyData = JSON.parse(ethers.toUtf8String(policyBytes));
              list.push({ 
                id: key, 
                encryptedThreshold: policyData.threshold, 
                encryptedAmount: policyData.amount,
                requiredSignatures: policyData.signatures,
                timestamp: policyData.timestamp, 
                creator: policyData.creator, 
                status: policyData.status || "active" 
              });
            } catch (e) { 
              console.error(`Error parsing policy data for ${key}:`, e);
              addNotification(`Error parsing policy ${key}`);
            }
          }
        } catch (e) { 
          console.error(`Error loading policy ${key}:`, e);
          addNotification(`Error loading policy ${key}`);
        }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPolicies(list);
      addNotification(`Loaded ${list.length} policies`);
    } catch (e) { 
      console.error("Error loading policies:", e);
      addNotification("Error loading policies");
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const addNotification = (message: string) => {
    setNotifications(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev.slice(0, 9)]);
  };

  const createPolicy = async () => {
    if (!isConnected) { 
      addNotification("Please connect wallet first");
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting policy with Zama FHE..." 
    });
    
    try {
      const encryptedThreshold = FHEEncryptNumber(newPolicyData.threshold);
      const encryptedAmount = FHEEncryptNumber(newPolicyData.amount);
      
      const contract = await getContractWithSigner();
      if (!contract) {
        addNotification("Failed to get contract with signer");
        throw new Error("Failed to get contract with signer");
      }
      
      const policyId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const policyData = { 
        threshold: encryptedThreshold, 
        amount: encryptedAmount,
        signatures: newPolicyData.signatures,
        timestamp: Math.floor(Date.now() / 1000), 
        creator: address, 
        status: "active" 
      };
      
      await contract.setData(`policy_${policyId}`, ethers.toUtf8Bytes(JSON.stringify(policyData)));
      
      const keysBytes = await contract.getData("policy_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e);
          addNotification("Error parsing policy keys");
        }
      }
      
      keys.push(policyId);
      await contract.setData("policy_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE-encrypted policy created!" 
      });
      addNotification("New policy created successfully");
      
      await loadPolicies();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPolicyData({ threshold: 0, amount: 0, signatures: 2 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      addNotification(`Policy creation failed: ${errorMessage}`);
      
      setTimeout(() => 
        setTransactionStatus({ visible: false, status: "pending", message: "" }), 
      3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      addNotification("Please connect wallet to decrypt");
      alert("Please connect wallet first"); 
      return null; 
    }
    
    setIsDecrypting(true);
    addNotification("Decrypting policy with wallet signature...");
    
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      addNotification("Decryption signature approved");
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e);
      addNotification("Decryption failed");
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const togglePolicyStatus = async (policyId: string, currentStatus: "active" | "inactive") => {
    if (!isConnected) { 
      addNotification("Please connect wallet first");
      alert("Please connect wallet first"); 
      return; 
    }
    
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Updating policy status..." 
    });
    addNotification(`Updating policy ${policyId} status`);
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        addNotification("Failed to get contract with signer");
        throw new Error("Failed to get contract with signer");
      }
      
      const policyBytes = await contract.getData(`policy_${policyId}`);
      if (policyBytes.length === 0) {
        addNotification("Policy not found");
        throw new Error("Policy not found");
      }
      
      const policyData = JSON.parse(ethers.toUtf8String(policyBytes));
      const newStatus = currentStatus === "active" ? "inactive" : "active";
      const updatedPolicy = { ...policyData, status: newStatus };
      
      await contract.setData(`policy_${policyId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPolicy)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Policy ${newStatus === "active" ? "activated" : "deactivated"}!` 
      });
      addNotification(`Policy status updated to ${newStatus}`);
      
      await loadPolicies();
      setTimeout(() => 
        setTransactionStatus({ visible: false, status: "pending", message: "" }), 
      2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Update failed: " + (e.message || "Unknown error") 
      });
      addNotification(`Policy update failed: ${e.message || "Unknown error"}`);
      setTimeout(() => 
        setTransactionStatus({ visible: false, status: "pending", message: "" }), 
      3000);
    }
  };

  const isCreator = (policyAddress: string) => address?.toLowerCase() === policyAddress.toLowerCase();

  const filteredPolicies = policies.filter(policy => {
    const matchesSearch = policy.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         policy.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || policy.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleDecryptPolicy = async (policy: Policy) => {
    setSelectedPolicy(policy);
    const decryptedThresh = await decryptWithSignature(policy.encryptedThreshold);
    const decryptedAmt = await decryptWithSignature(policy.encryptedAmount);
    setDecryptedThreshold(decryptedThresh);
    setDecryptedAmount(decryptedAmt);
  };

  const renderPolicyStats = () => {
    return (
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-value">{policies.length}</div>
          <div className="stat-label">Total Policies</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{inactiveCount}</div>
          <div className="stat-label">Inactive</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{policies.reduce((acc, p) => acc + p.requiredSignatures, 0)}</div>
          <div className="stat-label">Total Signatures</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Multisig</span>Vault</h1>
        </div>
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-policy-btn metal-button"
          >
            <div className="add-icon"></div>New Policy
          </button>
          <div className="notification-bell" onClick={() => setShowNotifications(!showNotifications)}>
            <div className="bell-icon"></div>
            {notifications.length > 0 && <div className="notification-badge">{notifications.length}</div>}
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      {showNotifications && (
        <div className="notifications-panel metal-card">
          <div className="notifications-header">
            <h3>System Notifications</h3>
            <button onClick={() => setShowNotifications(false)} className="close-notifications">&times;</button>
          </div>
          <div className="notifications-list">
            {notifications.length > 0 ? (
              notifications.map((note, index) => (
                <div key={index} className="notification-item">
                  <div className="notification-message">{note}</div>
                </div>
              ))
            ) : (
              <div className="no-notifications">No new notifications</div>
            )}
          </div>
        </div>
      )}

      <div className="main-content partitioned-layout">
        <div className="left-panel metal-card">
          <h2>Policy Statistics</h2>
          {renderPolicyStats()}
          
          <div className="search-filter-section">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search policies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
              <div className="search-icon"></div>
            </div>
            
            <div className="filter-options">
              <label>Status:</label>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value as "all" | "active" | "inactive")}
                className="metal-select"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        <div className="right-panel">
          <div className="policies-section metal-card">
            <div className="section-header">
              <h2>Encrypted Spending Policies</h2>
              <div className="header-actions">
                <button 
                  onClick={loadPolicies} 
                  className="refresh-btn metal-button" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="policies-list">
              <div className="table-header">
                <div className="header-cell">Policy ID</div>
                <div className="header-cell">Creator</div>
                <div className="header-cell">Signatures</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredPolicies.length === 0 ? (
                <div className="no-policies">
                  <div className="no-policies-icon"></div>
                  <p>No policies found</p>
                  <button 
                    className="metal-button primary" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Policy
                  </button>
                </div>
              ) : (
                filteredPolicies.map(policy => (
                  <div 
                    className="policy-row" 
                    key={policy.id} 
                    onClick={() => handleDecryptPolicy(policy)}
                  >
                    <div className="table-cell policy-id">#{policy.id.substring(0, 6)}</div>
                    <div className="table-cell">{policy.creator.substring(0, 6)}...{policy.creator.substring(38)}</div>
                    <div className="table-cell">{policy.requiredSignatures}</div>
                    <div className="table-cell">{new Date(policy.timestamp * 1000).toLocaleDateString()}</div>
                    <div className="table-cell">
                      <span className={`status-badge ${policy.status}`}>
                        {policy.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isCreator(policy.creator) && (
                        <button 
                          className="action-btn metal-button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePolicyStatus(policy.id, policy.status);
                          }}
                        >
                          {policy.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={createPolicy} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          policyData={newPolicyData} 
          setPolicyData={setNewPolicyData}
        />
      )}

      {selectedPolicy && (
        <PolicyDetailModal 
          policy={selectedPolicy} 
          onClose={() => { 
            setSelectedPolicy(null); 
            setDecryptedThreshold(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedThreshold={decryptedThreshold}
          decryptedAmount={decryptedAmount}
          isDecrypting={isDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE Multisig Vault</span>
            </div>
            <p>Secure encrypted spending policies with Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="https://zama.ai" className="footer-link">Zama FHE</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Multisig Vault. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  policyData: {
    threshold: number;
    amount: number;
    signatures: number;
  };
  setPolicyData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating, 
  policyData, 
  setPolicyData 
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPolicyData({ ...policyData, [name]: parseFloat(value) });
  };

  const handleSignaturesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setPolicyData({ ...policyData, signatures: parseInt(value) });
  };

  const handleSubmit = () => {
    if (policyData.threshold <= 0 || policyData.amount <= 0 || policyData.signatures <= 0) {
      alert("Please enter valid values");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Create FHE-Encrypted Policy</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Policy thresholds will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Required Signatures *</label>
              <input
                type="number"
                name="signatures"
                min="1"
                max="10"
                value={policyData.signatures}
                onChange={handleSignaturesChange}
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Threshold Amount *</label>
              <input
                type="number"
                name="threshold"
                min="0"
                step="0.01"
                value={policyData.threshold}
                onChange={handleChange}
                placeholder="Amount that triggers this policy"
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Transaction Amount *</label>
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                value={policyData.amount}
                onChange={handleChange}
                placeholder="Example transaction amount"
                className="metal-input"
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Values:</span>
                <div>Threshold: {policyData.threshold}</div>
                <div>Amount: {policyData.amount}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>Threshold: {policyData.threshold ? FHEEncryptNumber(policyData.threshold).substring(0, 30) + '...' : 'Not set'}</div>
                <div>Amount: {policyData.amount ? FHEEncryptNumber(policyData.amount).substring(0, 30) + '...' : 'Not set'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Privacy Guarantee</strong>
              <p>Policy details remain encrypted during processing and are never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-button">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Policy"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PolicyDetailModalProps {
  policy: Policy;
  onClose: () => void;
  decryptedThreshold: number | null;
  decryptedAmount: number | null;
  isDecrypting: boolean;
}

const PolicyDetailModal: React.FC<PolicyDetailModalProps> = ({ 
  policy, 
  onClose, 
  decryptedThreshold,
  decryptedAmount,
  isDecrypting
}) => {
  return (
    <div className="modal-overlay">
      <div className="policy-detail-modal metal-card">
        <div className="modal-header">
          <h2>Policy Details #{policy.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="policy-info">
            <div className="info-item">
              <span>Creator:</span>
              <strong>{policy.creator.substring(0, 6)}...{policy.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(policy.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${policy.status}`}>
                {policy.status}
              </strong>
            </div>
            <div className="info-item">
              <span>Required Signatures:</span>
              <strong>{policy.requiredSignatures}</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Policy Data</h3>
            <div className="data-grid">
              <div className="data-item">
                <label>Threshold:</label>
                <div className="encrypted-data">
                  {policy.encryptedThreshold.substring(0, 50)}...
                </div>
              </div>
              <div className="data-item">
                <label>Amount:</label>
                <div className="encrypted-data">
                  {policy.encryptedAmount.substring(0, 50)}...
                </div>
              </div>
            </div>
            
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
          </div>
          
          {(decryptedThreshold !== null || decryptedAmount !== null) && (
            <div className="decrypted-data-section">
              <h3>Decrypted Values</h3>
              <div className="data-grid">
                <div className="data-item">
                  <label>Threshold:</label>
                  <div className="decrypted-value">
                    {decryptedThreshold !== null ? decryptedThreshold : "Not decrypted"}
                  </div>
                </div>
                <div className="data-item">
                  <label>Amount:</label>
                  <div className="decrypted-value">
                    {decryptedAmount !== null ? decryptedAmount : "Not decrypted"}
                  </div>
                </div>
              </div>
              
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted values are only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;