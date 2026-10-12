import java.util.*;

public class LectureOrganizer {
    static class Lecture {
        String title, subject, date;

        Lecture(String title, String subject, String date) {
            this.title = title;
            this.subject = subject;
            this.date = date;
        }
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        List<Lecture> lectures = new ArrayList<>();

        System.out.print("Number of lectures: ");
        int n = Integer.parseInt(sc.nextLine());

        for (int i = 0; i < n; i++) {
            System.out.println("\nLecture " + (i + 1));
            System.out.print("Title: ");
            String title = sc.nextLine();
            System.out.print("Subject: ");
            String subject = sc.nextLine();
            System.out.print("Date (YYYY-MM-DD): ");
            String date = sc.nextLine();

            lectures.add(new Lecture(title, subject, date));
        }

        lectures.sort(Comparator
            .comparing((Lecture l) -> l.subject,
                String.CASE_INSENSITIVE_ORDER)
            .thenComparing(l -> l.date));

        System.out.println("\n--- Organized Lectures ---");
        for (Lecture l : lectures) {
            System.out.println(
                l.subject + " | " + l.date + " | " + l.title);
        }

        sc.close();
    }
}
