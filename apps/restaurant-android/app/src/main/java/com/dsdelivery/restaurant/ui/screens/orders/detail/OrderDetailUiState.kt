package com.dsdelivery.restaurant.ui.screens.orders.detail

import com.dsdelivery.restaurant.data.model.CancelReason
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.RefundRejectReason
import com.dsdelivery.restaurant.data.model.RejectReason

data class OrderDetailUiState(
    val orderId: String,
    val isLoading: Boolean = false,
    val order: Order? = null,
    val errorMessage: String? = null,
    val actionMessage: String? = null,
    /** True while a request is in flight; every action button is disabled meanwhile. */
    val isSubmitting: Boolean = false,
    val showAcceptDialog: Boolean = false,
    val showRejectDialog: Boolean = false,
    val selectedRejectReason: RejectReason = RejectReason.UNAVAILABLE,
    val showVerifyDialog: Boolean = false,
    val verifyChecked: Boolean = false,
    val showCancelDialog: Boolean = false,
    val selectedCancelReason: CancelReason = CancelReason.OUT_OF_STOCK,
    val showRefundApproveDialog: Boolean = false,
    val showRefundRejectDialog: Boolean = false,
    val selectedRefundRejectReason: RefundRejectReason = RefundRejectReason.POLICY,
    val showRefundSentDialog: Boolean = false,
    val showReadyConfirm: Boolean = false,
    val showSelfDeliveredConfirm: Boolean = false,
    val actionNoticeText: String? = null
)
