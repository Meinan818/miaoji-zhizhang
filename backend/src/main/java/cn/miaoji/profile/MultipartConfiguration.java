package cn.miaoji.profile;

import jakarta.servlet.MultipartConfigElement;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MultipartConfiguration {
    @Bean
    MultipartConfigElement multipartConfigElement(AvatarStorage storage) {
        // 使用已解析的绝对项目路径，避免容器将相对目录放到C盘临时区。
        return new MultipartConfigElement(storage.temporaryDirectory().toString(), AvatarStorage.MAX_UPLOAD,
                3 * 1024 * 1024, 0);
    }
}
