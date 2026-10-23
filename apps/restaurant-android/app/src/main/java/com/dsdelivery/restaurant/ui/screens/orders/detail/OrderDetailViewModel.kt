package com.dsdelivery.restaurant.ui.screens.orders.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.CancelReason
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.RefundRejectReason
import com.dsdelivery.restaurant.data.model.RejectReason
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Everything the detail screen can ask for. Defaults are no-ops so previews need no ViewModel. */
interface OrderDetailCallbacks {
    fun loadOrder() {}
    fun showAcceptDialog(show: Boolean) {}
    fun onPrepOverride(minutes: Int?) {}
    fun confirmAccept() {}
    fun showRejectDialog(show: Boolean) {}
    fun onRejectReasonSelected(reason: RejectReason) {}
    fun confirmReject() {}
    fun showVerifyDialog(show: Boolean) {}
    fun onVerifyChecked(checked: Boolean) {}
    fun confirmVerify() {}
    fun startPreparing() {}
    fun showReadyConfirm(show: Boolean) {}
    fun confirmReady() {}
    fun showCancelDialog(show: Boolean) {}
    fun onCancelReasonSelected(reason: CancelReason) {}
    fun confirmCancel() {}
    fun showRefundApproveDialog(show: Boolean) {}
    fun confirmRefundApprove() {}
    fun showRefundRejectDialog(show: Boolean) {}
    fun onRefundRejectReasonSelected(reason: RefundRejectReason) {}
    fun confirmRefundReject() {}
    fun showRefundSentDialog(show: Boolean) {}
    fun confirmRefundSent(receiptJpeg: ByteArray) {}
    fun dismissActionNotice() {}
    fun dismissActionMessage() {}
}

class OrderDetailViewModel(
    private val orderId: String,
    private val repository: RestaurantRepository
) : ViewModel(), OrderDetailCallbacks {

    private val _uiState = MutableStateFlow(OrderDetailUiState(orderId = orderId))
    val uiState: StateFlow<OrderDetailUiState> = _uiState.asStateFlow()

    init {
        loadOrder()
    }

    override fun loadOrder() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            when (val result = repository.getOrder(orderId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false, order = result.data, errorMessage = null) }
                }
                is Resource.Error -> {
                    // Never substitute sample data for a failed live request; keep only an order
                    // that was really loaded earlier.
                    _uiState.update { it.copy(isLoading = false, errorMessage = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    // ---- dialogs ---------------------------------------------------------------------------------------------
    override fun showAcceptDialog(show: Boolean) = _uiState.update { it.copy(showAcceptDialog = show, prepOverride = null) }.let { }
    override fun onPrepOverride(minutes: Int?) = _uiState.update { it.copy(prepOverride = minutes?.coerceIn(5, 120)) }.let { }
    override fun showRejectDialog(show: Boolean) = _uiState.update { it.copy(showRejectDialog = show) }.let { }
    override fun onRejectReasonSelected(reason: RejectReason) = _uiState.update { it.copy(selectedRejectReason = reason) }.let { }
    override fun showVerifyDialog(show: Boolean) = _uiState.update { it.copy(showVerifyDialog = show, verifyChecked = false) }.let { }
    override fun onVerifyChecked(checked: Boolean) = _uiState.update { it.copy(verifyChecked = checked) }.let { }
    override fun showReadyConfirm(show: Boolean) = _uiState.update { it.copy(showReadyConfirm = show) }.let { }
    override fun showCancelDialog(show: Boolean) = _uiState.update { it.copy(showCancelDialog = show) }.let { }
    override fun onCancelReasonSelected(reason: CancelReason) = _uiState.update { it.copy(selectedCancelReason = reason) }.let { }
    override fun showRefundApproveDialog(show: Boolean) = _uiState.update { it.copy(showRefundApproveDialog = show) }.let { }
    override fun showRefundRejectDialog(show: Boolean) = _uiState.update { it.copy(showRefundRejectDialog = show) }.let { }
    override fun onRefundRejectReasonSelected(reason: RefundRejectReason) = _uiState.update { it.copy(selectedRefundRejectReason = reason) }.let { }
    override fun showRefundSentDialog(show: Boolean) = _uiState.update { it.copy(showRefundSentDialog = show) }.let { }

    /**
     * Runs one order mutation. A second tap while a request is in flight is ignored (also server-side idempotent),
     * the status the user was looking at is sent so a stale screen fails with 409, and the order shown afterwards is
     * always the server's.
     */
    private fun runAction(success: String, call: suspend (expectedStatus: String?) -> Resource<Order>) {
        val current = _uiState.value
        if (current.isSubmitting) return
        val expected = current.order?.status?.name
        _uiState.update {
            it.copy(
                isSubmitting = true,
                showAcceptDialog = false, showRejectDialog = false, showVerifyDialog = false,
                showReadyConfirm = false, showCancelDialog = false, showRefundApproveDialog = false,
                showRefundRejectDialog = false, showRefundSentDialog = false
            )
        }
        viewModelScope.launch {
            when (val result = call(expected)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isSubmitting = false, order = result.data, actionMessage = success, errorMessage = null)
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, actionNoticeText = result.message) }
                    // Pull the real state (e.g. the order was already changed on another device).
                    loadOrder()
                }
                Resource.Loading -> {}
            }
        }
    }

    // ---- actions ---------------------------------------------------------------------------------------------
    override fun confirmAccept() {
        val override = _uiState.value.prepOverride
        runAction("Qabul qilindi.") { expected ->
            repository.acceptOrder(orderId, override, expected)
        }
    }

    override fun confirmReject() {
        val reason = _uiState.value.selectedRejectReason
        runAction("Rad etildi.") { expected ->
            repository.rejectOrder(orderId, reason.code, expected)
        }
    }

    override fun confirmVerify() {
        if (!_uiState.value.verifyChecked) return
        runAction("To‘lov tasdiqlandi.") { expected ->
            repository.verifyPayment(orderId, expected)
        }
    }

    /** Only needed when automatic start did not happen (exception state); no extra question: the default time is used. */
    override fun startPreparing() {
        runAction("Tayyorlash boshlandi.") { expected ->
            repository.setOrderPreparing(orderId, null, expected)
        }
    }

    override fun confirmReady() {
        runAction("Tayyor.") { expected ->
            repository.setOrderReady(orderId, expected)
        }
    }

    override fun confirmCancel() {
        val reason = _uiState.value.selectedCancelReason
        runAction("Bekor qilindi. Pulni qaytaring va chekni yuklang.") { expected ->
            repository.cancelOrder(orderId, reason.code, expected)
        }
    }

    override fun confirmRefundApprove() {
        runAction("Rozi bo‘ldingiz. Pulni qaytaring va chekni yuklang.") { expected ->
            repository.approveRefund(orderId, expected)
        }
    }

    override fun confirmRefundReject() {
        val reason = _uiState.value.selectedRefundRejectReason
        runAction("Bekor qilish rad etildi.") { expected ->
            repository.rejectRefund(orderId, reason.code, expected)
        }
    }

    override fun confirmRefundSent(receiptJpeg: ByteArray) {
        if (receiptJpeg.size < 1024) return
        runAction("Yuborildi. Mijoz tasdig‘i kutilmoqda.") { expected ->
            repository.uploadRefundReceipt(orderId, receiptJpeg, expected)
        }
    }

    override fun dismissActionNotice() {
        _uiState.update { it.copy(actionNoticeText = null) }
    }

    override fun dismissActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}
