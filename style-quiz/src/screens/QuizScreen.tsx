import React, { useState } from "react";
import { Alert, Dimensions, Image, StyleSheet, Text, View } from "react-native";
import Swiper from "react-native-deck-swiper";

// import your JSON dataset
import clothingData from "../../assets/clothing_data.json";

const { width } = Dimensions.get("window");

// shuffle + take first 20 items (initial quiz deck)
const sampleData = clothingData
  .sort(() => Math.random() - 0.5)
  .slice(0, 20);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flex: 0.75,
    borderRadius: 10,
    shadowRadius: 25,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 0 },
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 10,
  },
  image: {
    width: width * 0.8,
    height: width * 1.0,
    borderRadius: 10,
  },
});

function QuizScreen() {
  const [liked, setLiked] = useState<any[]>([]);
  const [disliked, setDisliked] = useState<any[]>([]);
  const [swipeCount, setSwipeCount] = useState(0);
  const [cards, setCards] = useState(sampleData); // 🔑 current deck
  const [recommendations, setRecommendations] = useState<any[]>([]);

  console.log("✅ QuizScreen is rendering...");

  // Send preferences to backend after quiz
  const sendPreferencesToBackend = async () => {
    try {
      const response = await fetch("http://localhost:4000/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked, disliked }),
      });

      const data = await response.json();
      console.log("Server response:", data);

      // Show user archetype alert
      if (data.archetype_spectrum && data.archetype_spectrum.length > 0) {
        const archetypes = data.archetype_spectrum.map((a: any) => a.name);
        Alert.alert(
          "Your Style Archetype",
          `You are more into ${archetypes.join(", ")} styles!`
        );
      }

      // Set top recommendations
      if (data?.recommendations && data.recommendations.length > 0) {
        setRecommendations(data.recommendations.slice(0, 10));
        setCards(data.recommendations.slice(0, 10)); // show recommended deck
        setSwipeCount(0);
      }
    } catch (error) {
      console.error("Error sending preferences:", error);
    }
  };

  // Handle card swipes
  const handleSwipe = (direction: "left" | "right", cardIndex: number) => {
    setSwipeCount((prev) => prev + 1);

    if (direction === "right") {
      setLiked((prev) => [...prev, cards[cardIndex]]);
    } else {
      setDisliked((prev) => [...prev, cards[cardIndex]]);
    }

    // After finishing initial quiz deck
    if (swipeCount + 1 === sampleData.length) {
      console.log("🎉 Finished quiz!");
      sendPreferencesToBackend();
    }
  };

  return (
    <View style={styles.container}>
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
                <Text>Image not available</Text>
              )}
            </View>
          ) : (
            <Text>No more outfits</Text>
          )
        }
        onSwipedRight={(cardIndex) => handleSwipe("right", cardIndex)}
        onSwipedLeft={(cardIndex) => handleSwipe("left", cardIndex)}
        backgroundColor={"#f4f4f4"}
        cardIndex={0}
        stackSize={3}
      />
    </View>
  );
}

export default QuizScreen;
