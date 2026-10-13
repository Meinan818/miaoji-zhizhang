package cn.miaoji.auth;

public interface VerificationMailer {
    void send(String recipient, String code);
}
