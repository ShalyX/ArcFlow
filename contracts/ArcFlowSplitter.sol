// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract ArcFlowSplitter {
    error EmptyIntentId();
    error InvalidRecipient();
    error InvalidAmount();
    error LengthMismatch();
    error TransferFailed();

    IERC20 public immutable usdc;

    event SplitSettled(
        bytes32 indexed intentId,
        address indexed payer,
        uint256 totalAmount,
        address[] recipients,
        uint256[] amounts
    );

    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) revert InvalidRecipient();
        usdc = IERC20(usdcAddress);
    }

    function payAndSplit(bytes32 intentId, address[] calldata recipients, uint256[] calldata amounts) external {
        if (intentId == bytes32(0)) revert EmptyIntentId();
        if (recipients.length == 0 || recipients.length != amounts.length) revert LengthMismatch();

        uint256 totalAmount = 0;
        for (uint256 index = 0; index < recipients.length; index++) {
            if (recipients[index] == address(0)) revert InvalidRecipient();
            if (amounts[index] == 0) revert InvalidAmount();
            totalAmount += amounts[index];
        }

        if (!usdc.transferFrom(msg.sender, address(this), totalAmount)) revert TransferFailed();

        for (uint256 index = 0; index < recipients.length; index++) {
            if (!usdc.transfer(recipients[index], amounts[index])) revert TransferFailed();
        }

        emit SplitSettled(intentId, msg.sender, totalAmount, recipients, amounts);
    }
}
