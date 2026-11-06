namespace DsRestaurant.Core.Api;

public class ApiError
{
    public int StatusCode { get; }
    public string? Code { get; }
    public string Message { get; }
    public int? RetryAfterSeconds { get; }

    public ApiError(int statusCode, string? code, string message, int? retryAfterSeconds = null)
    {
        StatusCode = statusCode;
        Code = code;
        Message = message;
        RetryAfterSeconds = retryAfterSeconds;
    }

    public static string MapToUzbek(int statusCode, string? code)
    {
        return statusCode switch
        {
            400 => code switch
            {
                "CARD_NUMBER_INVALID" => "Karta raqami noto‘g‘ri.",
                "Validation failed" => "Ma'lumotlar noto‘g‘ri kiritilgan.",
                "DATE_FILTER_INVALID" => "Sana noto‘g‘ri.",
                "DATE_RANGE_TOO_LARGE" => "Sana oralig‘i juda katta (eng ko‘pi 366 kun).",
                _ => !string.IsNullOrWhiteSpace(code) ? code : "So‘rov noto‘g‘ri."
            },
            401 => code switch
            {
                "INVALID_CREDENTIALS" => "Restoran kodi yoki parol noto‘g‘ri.",
                "UNAUTHENTICATED" => "Qayta kiring.",
                _ => "Qayta kiring."
            },
            403 => code switch
            {
                "PASSWORD_INVALID" => "Parol noto‘g‘ri.",
                "RESTAURANT_INACTIVE" => "Restoran to‘xtatilgan. Administrator bilan bog‘laning.",
                "FINANCE_PIN_WRONG" => "Moliya kodi noto‘g‘ri.",
                _ => "Ruxsat yo‘q."
            },
            404 => code switch
            {
                "NOT_FOUND" => "Topilmadi.",
                _ => "Topilmadi."
            },
            409 => code switch
            {
                "VERSION_CONFLICT" => "Boshqa joyda o‘zgartirilgan. Yangilab, qayta urinib ko‘ring.",
                "DUPLICATE_NAME" => "Bunday nom allaqachon bor.",
                "CATEGORY_NOT_EMPTY" => "Toifada taomlar bor. Avval ularni boshqa toifaga o‘tkazing.",
                "ARCHIVED" => "Taom allaqachon olib tashlangan.",
                "STALE" => "Buyurtma allaqachon o‘zgargan. Yangilandi.",
                "INVALID_STATE" => "Hozir bu amalni bajarib bo‘lmaydi.",
                "TIMED_OUT" => "Vaqt tugadi, buyurtma bekor qilindi.",
                "RESTAURANT_CLOSED" => "Qabul to‘xtatilgan. Sozlamalarda yoqing yoki buyurtmani rad eting.",
                "PAYMENT_EVIDENCE_INVALID" => "To‘lov mos kelmadi. Administrator bilan bog‘laning.",
                "PRICE_EDIT_REQUIRES_PAUSE" => "Narxni o‘zgartirish uchun avval Sozlamalarda qabulni to‘xtating.",
                "PRICE_PROPOSALS_REMOVED" => "Buyurtmadan keyin narxni o‘zgartirib bo‘lmaydi.",
                "REFUND_ALREADY_OPEN" => "Bu buyurtma uchun bekor qilish so‘rovi allaqachon bor.",
                "NO_OPEN_REFUND" => "So‘rov topilmadi. Yangilandi.",
                "ORDER_PROBLEMS" => "Qabul qilib bo‘lmaydi: menyu yoki narx o‘zgargan. Buyurtmani rad eting.",
                "FINANCE_NO_PIN" => "Moliya kodi berilmagan. 4 xonali kodni administratordan oling.",
                "CARD_TAKEN" => "Bu kartani qo‘shib bo‘lmaydi: oxirgi 4 raqami band. Administrator bilan bog‘laning.",
                "CARD_EXISTS" => "Bu karta ro‘yxatda bor. Uni yoqing.",
                "CARD_LIMIT" => "Kartalar soni chegaraga yetdi.",
                "CARD_PENDING_LIMIT" => "Tasdiq kutayotgan kartalar bor. Administrator tasdiqlagach yana qo‘shing.",
                "NOT_APPROVED" => "Karta hali tasdiqlanmagan.",
                "KARTA_YOQ" => "Bronni yoqish uchun avval Sozlamalarda faol to‘lov kartasini qo‘shing.",
                _ => "Bajarib bo‘lmadi. Yangilab, qayta urinib ko‘ring."
            },
            422 => code switch
            {
                "INVALID_CATEGORY" => "Toifa noto‘g‘ri tanlangan.",
                _ => "Ma’lumotlar noto‘g‘ri."
            },
            423 => "Moliya oynasi yopilgan. Kodni qayta kiriting.",
            429 => code switch
            {
                "FINANCE_PIN_BLOCKED" => "Juda ko‘p xato kiritildi. Birozdan keyin urinib ko‘ring.",
                "TOO_MANY_ATTEMPTS" => "Juda ko‘p urinish. Birozdan keyin qayta urining.",
                _ => "Juda ko‘p so‘rov. Birozdan keyin qayta urining."
            },
            _ => "Server javob bermadi. Birozdan keyin qayta urining."
        };
    }

    public static string MapExceptionToUzbek(Exception ex)
    {
        if (ex is HttpRequestException || ex is System.Net.Sockets.SocketException)
        {
            return "Serverga ulanib bo‘lmadi. Internetni tekshiring.";
        }
        if (ex is TaskCanceledException or TimeoutException)
        {
            return "Internet sekin yoki server javob bermadi. Qayta urining.";
        }
        return "Xatolik yuz berdi. Qayta urining.";
    }
}
