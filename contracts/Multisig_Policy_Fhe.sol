pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MultisigPolicyFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60; // Default 1 minute cooldown

    bool public paused;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct Batch {
        uint256 id;
        bool isOpen;
        euint32 totalAmountEncrypted;
        euint32 numApprovalsEncrypted;
        euint32 threshold2Encrypted;
        euint32 threshold4Encrypted;
        euint32 limitEncrypted;
    }
    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId = 1;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchOpen();
    error InvalidThreshold();
    error InvalidLimit();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedContract(address indexed account);
    event UnpausedContract(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event PolicyParametersSubmitted(uint256 indexed batchId, address indexed provider);
    event TransactionSubmitted(uint256 indexed batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, bool approved);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
        lastSubmissionTime[msg.sender] = block.timestamp;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit PausedContract(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Revert if already unpaused
        paused = false;
        emit UnpausedContract(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldown) external onlyOwner {
        require(newCooldown > 0, "Cooldown must be positive");
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSecondsSet(oldCooldown, newCooldown);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batches[currentBatchId].isOpen) revert BatchOpen();
        batches[currentBatchId].isOpen = true;
        batches[currentBatchId].totalAmountEncrypted = FHE.asEuint32(0);
        batches[currentBatchId].numApprovalsEncrypted = FHE.asEuint32(0);
        batches[currentBatchId].threshold2Encrypted = FHE.asEuint32(2);
        batches[currentBatchId].threshold4Encrypted = FHE.asEuint32(4);
        batches[currentBatchId].limitEncrypted = FHE.asEuint32(10000); // Default limit 10000 units
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        batches[currentBatchId].isOpen = false;
        emit BatchClosed(currentBatchId);
        currentBatchId++;
    }

    function setPolicyParameters(
        euint32 threshold2,
        euint32 threshold4,
        euint32 limit
    ) external onlyProvider whenNotPaused respectCooldown {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        batches[currentBatchId].threshold2Encrypted = threshold2;
        batches[currentBatchId].threshold4Encrypted = threshold4;
        batches[currentBatchId].limitEncrypted = limit;
        emit PolicyParametersSubmitted(currentBatchId, msg.sender);
    }

    function submitTransaction(euint32 amount, euint32 numApprovals) external onlyProvider whenNotPaused respectCooldown {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        batches[currentBatchId].totalAmountEncrypted = batches[currentBatchId].totalAmountEncrypted.add(amount);
        batches[currentBatchId].numApprovalsEncrypted = batches[currentBatchId].numApprovalsEncrypted.add(numApprovals);
        emit TransactionSubmitted(currentBatchId, msg.sender);
    }

    function requestApprovalStatus(uint256 batchId) external whenNotPaused respectCooldown {
        if (batchId >= currentBatchId || !batches[batchId].isOpen) revert BatchClosed();

        // Prepare ciphertexts for decryption
        euint32 memory amount = batches[batchId].totalAmountEncrypted;
        euint32 memory numApprovals = batches[batchId].numApprovalsEncrypted;
        euint32 memory threshold2 = batches[batchId].threshold2Encrypted;
        euint32 memory threshold4 = batches[batchId].threshold4Encrypted;
        euint32 memory limit = batches[batchId].limitEncrypted;

        ebool memory condition1 = amount.le(limit);
        ebool memory condition2 = amount.gt(limit);

        ebool memory approvalStatus = condition1.and(numApprovals.ge(threshold2))
            .or(condition2.and(numApprovals.ge(threshold4)));

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(approvalStatus);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection prevents processing the same decryption request multiple times.

        Batch storage batch = batches[decryptionContexts[requestId].batchId];
        euint32 memory amount = batch.totalAmountEncrypted;
        euint32 memory numApprovals = batch.numApprovalsEncrypted;
        euint32 memory threshold2 = batch.threshold2Encrypted;
        euint32 memory threshold4 = batch.threshold4Encrypted;
        euint32 memory limit = batch.limitEncrypted;

        ebool memory condition1 = amount.le(limit);
        ebool memory condition2 = amount.gt(limit);
        ebool memory approvalStatus = condition1.and(numApprovals.ge(threshold2))
            .or(condition2.and(numApprovals.ge(threshold4)));

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(approvalStatus);
        bytes32 currentHash = _hashCiphertexts(currentCts);

        // Security: State hash verification ensures that the contract state relevant to the decryption
        // has not changed since the decryption was requested. This prevents using stale decryption results.
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        // Security: Proof verification ensures the decryption proof is valid and correctly signed
        // by the FHE decryption key holders.
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert DecryptionFailed();

        bool approved = abi.decode(cleartexts, (bool));
        decryptionContexts[requestId].processed = true;

        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, approved);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage item, uint32 plainValue) internal {
        if (!FHE.isInitialized(item)) {
            item = FHE.asEuint32(plainValue);
        }
    }

    function _requireInitialized(euint32 storage item) internal view {
        if (!FHE.isInitialized(item)) revert("Not initialized");
    }
}