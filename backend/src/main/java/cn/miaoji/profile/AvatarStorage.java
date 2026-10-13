package cn.miaoji.profile;

import cn.miaoji.common.ApiException;
import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

@Component
public class AvatarStorage {
    public static final long MAX_UPLOAD = 2 * 1024 * 1024;
    private final Path root;
    private final Path temporary;

    public AvatarStorage(@Value("${miaoji.storage-root}") String directory) throws IOException {
        var storage = Path.of(directory).toAbsolutePath().normalize();
        root = storage.resolve("avatars");
        temporary = storage.resolve("multipart");
        Files.createDirectories(root);
        Files.createDirectories(temporary);
    }

    public Path temporaryDirectory() { return temporary; }

    public byte[] normalize(MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() > MAX_UPLOAD
                || !("image/jpeg".equals(file.getContentType()) || "image/png".equals(file.getContentType()))) throw invalid();
        try {
            var bytes = file.getBytes();
            // 不信任扩展名或MIME：先验证文件签名，再由真实解码器读取。
            var png = bytes.length >= 8 && bytes[0] == (byte) 0x89 && bytes[1] == 'P' && bytes[2] == 'N'
                    && bytes[3] == 'G' && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
            var jpeg = bytes.length >= 3 && bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xd8 && bytes[2] == (byte) 0xff;
            if (!png && !jpeg) throw invalid();
            try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw invalid();
                var reader = readers.next();
                try {
                    // 部分JPEG解码器会容忍截断；警告图片不能替换已有头像。
                    reader.addIIOReadWarningListener((decoder, warning) -> { throw invalid(); });
                    reader.setInput(input, false, true);
                    int width = reader.getWidth(0), height = reader.getHeight(0);
                    // 解码像素前约束尺寸，避免小文件声明巨大图片导致内存耗尽。
                    if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long) width * height > 4_000_000) throw invalid();
                    var source = reader.read(0);
                    var target = new BufferedImage(256, 256, BufferedImage.TYPE_INT_RGB);
                    var graphics = target.createGraphics();
                    try {
                        graphics.setColor(new Color(255, 249, 239));
                        graphics.fillRect(0, 0, 256, 256);
                        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                        int side = Math.min(width, height), left = (width - side) / 2, top = (height - side) / 2;
                        graphics.drawImage(source, 0, 0, 256, 256, left, top, left + side, top + side, null);
                    } finally { graphics.dispose(); }
                    var output = new ByteArrayOutputStream();
                    try (var stream = new MemoryCacheImageOutputStream(output)) {
                        var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
                        try {
                            writer.setOutput(stream);
                            var parameters = writer.getDefaultWriteParam();
                            parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                            parameters.setCompressionQuality(0.86f);
                            writer.write(null, new javax.imageio.IIOImage(target, null, null), parameters);
                        } finally { writer.dispose(); }
                    }
                    return output.toByteArray();
                } finally { reader.dispose(); }
            }
        } catch (IOException | IllegalArgumentException error) { throw invalid(); }
    }

    public String store(byte[] photo) {
        var id = UUID.randomUUID().toString();
        try {
            Files.write(file(id), photo, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            return id;
        } catch (IOException error) { throw unavailable(); }
    }

    public byte[] read(String id) {
        try {
            var path = file(id);
            if (Files.size(path) > 256 * 1024) throw unavailable();
            return Files.readAllBytes(path);
        } catch (IOException error) { throw unavailable(); }
    }

    public void discardNewFile(String id) {
        // 仅清除本次新生成且数据库未提交的文件，旧头像不删除。
        try { Files.deleteIfExists(file(id)); }
        catch (IOException error) { throw unavailable(); }
    }

    private Path file(String id) {
        if (id == null || !id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) throw unavailable();
        var candidate = root.resolve(id + ".jpg").normalize();
        if (!candidate.startsWith(root)) throw unavailable();
        return candidate;
    }
    private ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PHOTO", "请使用2MB以内的有效JPEG或PNG照片，尺寸最多4096且总像素不超过400万"); }
    private ApiException unavailable() { return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "AVATAR_STORAGE_UNAVAILABLE", "头像存储暂不可用，请稍后重试"); }
}
