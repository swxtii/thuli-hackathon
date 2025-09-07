import React, { useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Swiper from "react-native-deck-swiper";
import clothingData from "../../assets/clothing_data.json";

const { width } = Dimensions.get("window");

// Shuffle dataset & take 20 for initial quiz
const sampleData = clothingData.sort(() => Math.random() - 0.5).slice(0, 20);

function QuizScreen() {
  const [liked, setLiked] = useState<any[]>([]);
  const [disliked, setDisliked] = useState<any[]>([]);
  const [cards, setCards] = useState(sampleData);
  const [isInitialQuiz, setIsInitialQuiz] = useState(true);

  // Handle swipe logic
  const handleSwipe = (direction: "left" | "right", cardIndex: number) => {
    const card = cards[cardIndex];
    if (!card) return;

    if (direction === "right") {
      setLiked((prev) => [...prev, card]);
    } else {
      setDisliked((prev) => [...prev, card]);
    }

    if (isInitialQuiz && cardIndex === cards.length - 1) {
      console.log("🎉 Finished initial quiz. Sending preferences...");
      sendPreferences();
    }
  };

  // Send quiz results to backend and load recs
  const sendPreferences = async () => {
    try {
      console.log("📤 Sending preferences to backend...");

      const prefResponse = await fetch("http://10.30.112.244:4000/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked, disliked }),
      });

      const prefData = await prefResponse.json();
      console.log("✅ Preferences response:", prefData);

      if (prefData.archetype_spectrum && prefData.archetype_spectrum.length > 0) {
        const archetypes = prefData.archetype_spectrum.map((a: any) => a.name);
        Alert.alert(
          "Your Style Archetype",
          `You are more into ${archetypes.join(", ")} styles!`
        );
      }

      const recResponse = await fetch(
        "http://10.30.112.244:4000/recommendations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked, disliked }),
        }
      );

      const recData = await recResponse.json();
      console.log("🎯 Recommendations received:", recData.recommendations);

      if (recData.recommendations && recData.recommendations.length > 0) {
        setCards(recData.recommendations.slice(0, 15));
        setIsInitialQuiz(false);
      } else {
        console.warn("⚠️ No personalized recommendations returned.");
        Alert.alert("No Recommendations", "Try swiping again to refine results.");
      }
    } catch (error) {
      console.error("❌ Error in preferences/recommendations:", error);
      Alert.alert("Error", "Failed to fetch recommendations. Check backend.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>StyleThread</Text>
      <Text style={styles.title}>
        {isInitialQuiz
          ? "Swipe right to like, left to dislike"
          : "Recommended Outfits For You"}
      </Text>

      <View style={styles.swiperContainer}>
        <Swiper
          cards={cards}
          renderCard={(item) =>
            item ? (
              <View style={styles.card}>
                {item.img ? (
                  <Image
                    source={{ uri: item.img }}
                    style={styles.image}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.noImageText}>Image not available</Text>
                )}
                <Text style={styles.nameText}>
                  {item.name || item.description || "Unnamed Outfit"}
                </Text>
              </View>
            ) : (
              <Text>No more outfits</Text>
            )
          }
          onSwipedRight={(i) => handleSwipe("right", i)}
          onSwipedLeft={(i) => handleSwipe("left", i)}
          backgroundColor="transparent"
          cardIndex={0}
          stackSize={3}
        />
      </View>
    </SafeAreaView>
  );
}

const { width: screenWidth } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff", // white background
    alignItems: "center",
  },
  title: {
    fontSize: 24, // bigger title
    fontWeight: "700",
    color: "#222", // dark grey
    marginTop: 20,
    marginBottom: 15,
  },
  swiperContainer: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flex: 0.75,
    borderRadius: 12,
    backgroundColor: "#000", // black card background
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  image: {
    width: screenWidth * 0.8,
    height: screenWidth * 1.0,
    borderRadius: 12,
  },
  nameText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
    color: "#fff", // white text inside black card
  },
  noImageText: {
    fontSize: 14,
    color: "#ccc",
  },
});

export default QuizScreen;
