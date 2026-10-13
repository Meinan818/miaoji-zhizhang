package cn.miaoji.common;

import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<?> api(ApiException error) {
        return ResponseEntity.status(error.status()).body(Map.of("code", error.code(), "message", error.getMessage()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> invalid(Exception error) {
        // 不返回 rejectedValue、SQL、请求原文或密码。
        return ResponseEntity.badRequest().body(Map.of("code", "INVALID_INPUT", "message", "请求格式或字段不合法"));
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> storage(DataAccessException error) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("code", "STORAGE_UNAVAILABLE", "message", "账本服务暂不可用，请稍后重试"));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<?> uploadTooLarge(MaxUploadSizeExceededException error) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(Map.of("code", "PHOTO_TOO_LARGE", "message", "照片须在2MB以内"));
    }
}
